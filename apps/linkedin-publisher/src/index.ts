import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LinkedInPostPublisher, LinkedInPostReceipt } from "../../../packages/adapters/src/linkedin.js";
import { can, type IdentityCapability, type IdentityStore } from "../../../packages/identity/src/index.js";

export type ScheduledPostStatus = "approved" | "dispatching" | "reconciliation_required" | "authorization_required" | "reauth_required" | "posted" | "posted_unverified" | "failed";
export interface PublicationApproval { artifactId: string; artifactHash: string; approvedBodyHash: string; approvedBy: string; approvedAt: string; accountConnectionId: string; scheduledAt: string; }
export interface AcceptedArtifact { artifactId: string; sha256: string; content: unknown; quality: number; }
export interface AcceptedArtifactResolver { getAcceptedArtifact(id: string): Promise<AcceptedArtifact | undefined>; }
export function acceptedArtifactResolver(source: { getArtifact(id: string): { artifact_id: string; sha256: string; quality: number } | undefined; getArtifactContent(id: string): unknown }): AcceptedArtifactResolver {
  return { async getAcceptedArtifact(id) { const artifact = source.getArtifact(id); const content = source.getArtifactContent(id); return artifact && content !== undefined && artifact.quality >= 0.8 ? { artifactId: artifact.artifact_id, sha256: artifact.sha256, content, quality: artifact.quality } : undefined; } };
}
export interface ScheduledLinkedInPost { id: string; scheduledAt: string; body: string; approval: PublicationApproval; status: ScheduledPostStatus; createdAt: string; postUrn?: string; receipt?: LinkedInPostReceipt; failure?: string; }

export function hashPostBody(body: string): string { return createHash("sha256").update(body, "utf8").digest("hex"); }
export function authorizePublication(store: IdentityStore, approval: PublicationApproval, capability: IdentityCapability = "factory.publish"): boolean { const user = store.getUser(approval.approvedBy); return Boolean(user && can({ user, admin: store.getAdminForUser(user.id) }, capability)); }

export class ScheduledLinkedInPostQueue {
  private posts: ScheduledLinkedInPost[];
  constructor(private readonly storagePath: string) {
    mkdirSync(dirname(storagePath), { recursive: true });
    try { this.posts = JSON.parse(readFileSync(storagePath, "utf8")) as ScheduledLinkedInPost[]; } catch { this.posts = []; }
    for (const post of this.posts) if (post.status === "dispatching") post.status = "reconciliation_required";
    this.persist();
  }
  list(): ScheduledLinkedInPost[] { return this.posts.map((post) => ({ ...post, approval: { ...post.approval } })); }

  async schedule(post: Omit<ScheduledLinkedInPost, "createdAt" | "status"> & { status?: "approved" }, artifacts: AcceptedArtifactResolver): Promise<ScheduledLinkedInPost> {
    if (this.posts.some((existing) => existing.id === post.id)) throw new Error(`duplicate scheduled post ${post.id}`);
    if (!post.body.trim() || post.body.includes("[UPDATE WITH REAL DATA")) throw new Error("post is not publication-ready");
    if (post.approval.scheduledAt !== post.scheduledAt || post.approval.approvedBodyHash !== hashPostBody(post.body)) throw new Error("publication approval does not match scheduled post");
    if (!post.approval.artifactId || !post.approval.artifactHash || !post.approval.approvedBy || !post.approval.accountConnectionId) throw new Error("publication approval is incomplete");
    const artifact = await artifacts.getAcceptedArtifact(post.approval.artifactId);
    if (!artifact || artifact.artifactId !== post.approval.artifactId || artifact.sha256 !== post.approval.artifactHash || artifact.quality < 0.8) throw new Error("accepted artifact does not match publication approval");
    const record: ScheduledLinkedInPost = { ...post, status: "approved", createdAt: new Date().toISOString() };
    this.posts.push(record); this.persist(); return { ...record, approval: { ...record.approval } };
  }

  async tick(now: Date, publisher: Pick<LinkedInPostPublisher, "publishText">, authorize: (approval: PublicationApproval) => boolean = () => true): Promise<ScheduledLinkedInPost[]> {
    const processed: ScheduledLinkedInPost[] = [];
    for (const post of this.posts) {
      if (post.status !== "approved" || new Date(post.scheduledAt) > now) continue;
      if (post.approval.approvedBodyHash !== hashPostBody(post.body) || !authorize(post.approval)) { post.status = "authorization_required"; this.persist(); processed.push({ ...post, approval: { ...post.approval } }); continue; }
      post.status = "dispatching"; post.failure = undefined; this.persist();
      try {
        const receipt = await publisher.publishText(post.body);
        post.receipt = receipt; post.postUrn = receipt.postUrn; post.status = receipt.state === "verified" ? "posted" : "posted_unverified";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error); post.failure = message;
        post.status = /reauthorization|required|access token|refresh/i.test(message) ? "reauth_required" : "reconciliation_required";
      }
      processed.push({ ...post, approval: { ...post.approval } }); this.persist();
    }
    return processed;
  }

  reconcile(postId: string, receipt: LinkedInPostReceipt): ScheduledLinkedInPost {
    const post = this.posts.find((item) => item.id === postId); if (!post) throw new Error(`unknown scheduled post ${postId}`);
    if (post.status !== "reconciliation_required") throw new Error(`post ${postId} is not awaiting reconciliation`);
    post.receipt = receipt; post.postUrn = receipt.postUrn; post.status = receipt.state === "verified" ? "posted" : "posted_unverified"; post.failure = undefined; this.persist(); return { ...post, approval: { ...post.approval } };
  }

  private persist() { writeFileSync(this.storagePath, JSON.stringify(this.posts, null, 2)); }
}
