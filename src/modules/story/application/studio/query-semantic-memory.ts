import { SemanticMemoryEngine } from "../semantic-memory.js";
import type { QuerySemanticMemoryStore } from "../../ports/studio/query-semantic-memory-store.js";
export function querySemanticMemory(bible: QuerySemanticMemoryStore, args: {
    id: string;
    episode: number;
    body: {
        queryText: string;
        topK?: number | undefined;
        tokenBudget?: number | undefined;
    };
}) {
    const { id, episode, body } = args;
    const engine = new SemanticMemoryEngine();
    engine.indexStoryBible(bible, id, episode);
    const queryResults = engine.queryRelevant(body.queryText, {
        topK: body.topK ?? 15,
        currentEpisode: episode,
    });
    const allChars = bible.listCharacters(id);
    const allProps = bible.listKeyProps(id);
    const allLocs = bible.listLocations(id);
    const pruned = engine.pruneContextForEpisode(body.queryText, allChars, allProps, allLocs, body.tokenBudget ?? 3000, { currentEpisode: episode });
    return {
        queryResults,
        prunedContext: {
            relevantCharacters: pruned.relevantCharacters.map((c) => ({
                id: c.id,
                name: c.name,
                role: c.role,
                status: c.status,
                visual_summary: c.visual_summary,
            })),
            relevantProps: pruned.relevantProps.map((p) => ({
                id: p.id,
                name: p.name,
                current_holder_id: p.current_holder_id,
                description: p.description,
            })),
            relevantLocations: pruned.relevantLocations.map((l) => ({
                id: l.id,
                name: l.name,
                visual_summary: l.visual_summary,
            })),
            relevantRules: pruned.relevantRules,
            totalRetrievedItems: pruned.totalRetrievedItems,
            estimatedTokens: pruned.estimatedTokens,
            scores: pruned.scores,
        },
    };
}
