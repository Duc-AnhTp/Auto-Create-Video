import { z } from 'zod';
const Relationship = z.object({ target: z.string().optional(), type: z.string().optional(), sentiment: z.enum(['positive', 'negative', 'neutral']).optional() });
const Graph = z.union([z.array(Relationship), z.record(z.string(), z.union([z.string(), Relationship]))]);
import { log } from '../../../../platform/observability/logger.js';
import type { ReadNarrativeGraphStore } from "../../ports/studio/read-narrative-graph-store.js";
export function readNarrativeGraph(bible: ReadNarrativeGraphStore, args: {
    id: string;
}) {
    const { id } = args;
    const characters = bible.listCharacters(id);
    const locations = bible.listLocations(id);
    const props = bible.listKeyProps(id);
    const chekhovGuns = bible.listChekhovGuns(id);
    const worldState = bible.getAllWorldState(id);
    const nodes: Array<{
        id: string;
        label: string;
        type: "character" | "location" | "prop";
        status?: string;
        details?: string;
        image?: string;
    }> = [];
    const edges: Array<{
        source: string;
        target: string;
        relation: string;
        sentiment?: "positive" | "negative" | "neutral";
    }> = [];
    const propLedger: Array<{
        propId: string;
        propName: string;
        fromHolder?: string | null;
        toHolder?: string | null;
        episodeNumber: number;
        createdAt?: string;
    }> = [];
    for (const c of characters) {
        nodes.push({
            id: c.id,
            label: c.name,
            type: "character",
            status: c.status,
            details: c.visual_summary || c.distinguishing_marks,
            image: c.face_reference_image,
        });
        if (c.relationship_graph_json) {
            try {
                const parsed = Graph.parse(JSON.parse(c.relationship_graph_json));
                if (Array.isArray(parsed)) {
                    for (const r of parsed) {
                        if (r.target) {
                            edges.push({ source: c.id, target: r.target, relation: r.type || "relates_to", sentiment: r.sentiment });
                        }
                    }
                }
                else if (typeof parsed === "object" && parsed !== null) {
                    for (const [targetId, rel] of Object.entries(parsed)) {
                        edges.push({ source: c.id, target: targetId, relation: typeof rel === "string" ? rel : rel.type || "relates_to" });
                    }
                }
            }
            catch (caughtError) {
                log.warn("[read-narrative-graph] " + String(caughtError));
            }
        }
    }
    for (const l of locations) {
        nodes.push({
            id: l.id,
            label: l.name,
            type: "location",
            details: l.visual_summary || l.lighting_mood,
            image: l.reference_image_path,
        });
    }
    for (const p of props) {
        nodes.push({
            id: p.id,
            label: p.name,
            type: "prop",
            status: p.current_holder_id ? `held_by_${p.current_holder_id}` : "unclaimed",
            details: p.description,
        });
        if (p.current_holder_id) {
            edges.push({ source: p.id, target: p.current_holder_id, relation: "held_by" });
        }
        const transfers = bible.getPropTransfers(p.id);
        for (const t of transfers) {
            propLedger.push({
                propId: p.id,
                propName: p.name,
                fromHolder: t.from_holder_id,
                toHolder: t.to_holder_id,
                episodeNumber: t.episode_number,
                createdAt: t.created_at,
            });
        }
    }
    const gunItems = chekhovGuns.map((g) => {
        const isDormant = (g.payoff_status === "planted" || g.payoff_status === "active") &&
            ((g.dormant_episodes_count ?? 0) >= 2 ||
                (typeof g.last_active_episode === "number" && typeof g.planted_at_episode === "number"
                    ? g.last_active_episode - g.planted_at_episode >= 2
                    : false));
        return {
            id: g.id,
            name: g.description ? `${g.id}: ${g.description.slice(0, 30)}` : g.id,
            description: g.description,
            status: g.payoff_status || "planted",
            plantedEpisode: g.planted_at_episode,
            payoffEpisode: g.payoff_episode,
            lastActiveEpisode: g.last_active_episode,
            isDormant,
        };
    });
    return { nodes, edges, propLedger, chekhovGuns: gunItems, worldState };
}
