import { sha256Of } from "../../runtime/src/index.js";
import type { PressCorps, ReporterPersona } from "../../press/src/types.js";
import { validatePressCorps } from "../../press/src/corps.js";
import { validateAgentCard, type AgentCard, type PressCorpsCard } from "./contracts.js";

/** Hash of the card's content, excluding its custody trail. */
export const cardHash = (card: AgentCard) => { const { custody: _custody, ...content } = card; return sha256Of(JSON.parse(JSON.stringify(content))); };

export function currentLocation(card: AgentCard): string { return card.custody.at(-1)!.location; }

/**
 * Moves an agent between a creator and a factory (or factory to factory). The card travels whole;
 * each hop records where it went, who moved it, and the card's hash on arrival, so changes made in
 * one place are visible in the other.
 */
export function moveAgent(card: AgentCard, to: string, by: string, at = new Date().toISOString(), reason?: string): AgentCard {
  const errors = validateAgentCard(card);
  if (errors.length) throw new Error(`cannot move invalid agent ${card?.id}: ${errors.join("; ")}`);
  if (!/^(creator|factory):[A-Za-z0-9._-]+$/.test(to)) throw new Error(`invalid location ${to}`);
  if (currentLocation(card) === to) return card;
  return { ...card, custody: [...card.custody, { location: to, at, by, reason, cardSha256: cardHash(card) }] };
}

/** Accepts an agent arriving at this factory: it must be valid and already addressed here. */
export function importAgent(card: AgentCard, factoryId: string): AgentCard {
  const errors = validateAgentCard(card);
  if (errors.length) throw new Error(`invalid agent card ${card?.id}: ${errors.join("; ")}`);
  if (currentLocation(card) !== `factory:${factoryId}`) throw new Error(`agent ${card.id} is at ${currentLocation(card)}, not factory:${factoryId}; move it first`);
  return card;
}

/** Lists where the card changed between hops (content hash on arrival differs from the previous arrival). */
export function custodyChanges(card: AgentCard): Array<{ from: string; to: string; changed: boolean }> {
  return card.custody.slice(1).map((hop, i) => ({ from: card.custody[i].location, to: hop.location, changed: hop.cardSha256 !== card.custody[i].cardSha256 }));
}

export function personaFromAgentCard(card: AgentCard): ReporterPersona {
  if (!card.press) throw new Error(`agent ${card.id} has no press block`);
  return { id: card.id, name: card.name, title: card.title, lens: card.press.lens, theoryOfWinning: card.persona.theoryOfWinning ?? "", persona: card.persona.summary, color: card.press.color, rights: card.press.rights, maxFollowups: card.press.maxFollowups, questionsPerBeat: card.press.questionsPerBeat, voice: Object.fromEntries((card.assets?.voices ?? []).map((v) => [v.provider, v.providerRef ?? v.id])) };
}

export function pressCorpsFromCard(card: PressCorpsCard): PressCorps {
  const corps: PressCorps = { id: `${card.id}@${card.version}`, name: card.name, reporters: card.reporters.map(personaFromAgentCard), beats: card.beats };
  const errors = [...card.reporters.flatMap((r) => validateAgentCard(r).map((e) => `${r.id}: ${e}`)), ...validatePressCorps(corps)];
  if (errors.length) throw new Error(`invalid press corps ${card.id}: ${errors.join("; ")}`);
  return corps;
}
