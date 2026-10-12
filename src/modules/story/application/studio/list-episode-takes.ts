import type { ListEpisodeTakesStore } from "../../ports/studio/list-episode-takes-store.js";
export function listEpisodeTakes(bible: ListEpisodeTakesStore, args: {
    id: string;
    episode: number;
    shotId: string | undefined;
}) {
    const { id, episode, shotId } = args;
    return bible.listShotTakes(id, episode, shotId);
}
