import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LinkedInPostPublisher, LinkedInPostReceipt } from "../../../packages/adapters/src/linkedin.js";

export type ScheduledPostStatus = "approved" | "posted" | "posted_unverified" | "failed";

export interface ScheduledLinkedInPost {
  id: string;
  scheduledAt: string;
  body: string;
  status: ScheduledPostStatus;
  createdAt: string;
  postUrn?: string;
  receipt?: LinkedInPostReceipt;
  failure?: string;
}

export class ScheduledLinkedInPostQueue {
  private posts: ScheduledLinkedInPost[];

  constructor(private readonly storagePath: string) {
    mkdirSync(dirname(storagePath), { recursive: true });
    try { this.posts = JSON.parse(readFileSync(storagePath, "utf8")) as ScheduledLinkedInPost[]; }
    catch { this.posts = []; }
  }

  list(): ScheduledLinkedInPost[] { return this.posts.map((post) => ({ ...post })); }

  schedule(post: Omit<ScheduledLinkedInPost, "createdAt" | "status"> & { status?: "approved" }): ScheduledLinkedInPost {
    if (this.posts.some((existing) => existing.id === post.id)) throw new Error(`duplicate scheduled post ${post.id}`);
    if (!post.body.trim() || post.body.includes("[UPDATE WITH REAL DATA")) throw new Error("post is not publication-ready");
    const record: ScheduledLinkedInPost = { ...post, status: "approved", createdAt: new Date().toISOString() };
    this.posts.push(record); this.persist(); return { ...record };
  }

  async tick(now: Date, publisher: Pick<LinkedInPostPublisher, "publishText">): Promise<ScheduledLinkedInPost[]> {
    const processed: ScheduledLinkedInPost[] = [];
    for (const post of this.posts) {
      if (post.status !== "approved" || new Date(post.scheduledAt) > now) continue;
      try {
        const receipt = await publisher.publishText(post.body);
        post.receipt = receipt; post.postUrn = receipt.postUrn; post.status = receipt.state === "verified" ? "posted" : "posted_unverified";
      } catch (error) { post.status = "failed"; post.failure = error instanceof Error ? error.message : String(error); }
      processed.push({ ...post }); this.persist();
    }
    return processed;
  }

  private persist() { writeFileSync(this.storagePath, JSON.stringify(this.posts, null, 2)); }
}
