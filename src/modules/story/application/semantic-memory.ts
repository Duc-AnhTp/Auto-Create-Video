import {log} from '../../../platform/observability/logger.js';
import type { SemanticMemoryStore } from "../ports/semantic-memory-store.js";
import type { CharacterRecord, KeyPropRecord, LocationRecord, EpisodeSummaryRecord, StoryBeatRecord } from "../../../contracts/story.js";

export type SemanticEntityType =
  | "character"
  | "prop"
  | "location"
  | "world_rule"
  | "relationship"
  | "episode_summary"
  | "canon_fact"
  | "story_beat";

export interface SemanticMemoryItem {
  id: string;
  entityType: SemanticEntityType;
  entityId: string;
  text: string;
  vector: Float32Array;
  importance: number; // 0.0 - 1.0 (trọng số ưu tiên)
  episodeScope?: { introducedIn: number; deprecatedIn?: number };
  metadata?: Record<string, any>;
}

export interface QueryResultItem extends SemanticMemoryItem {
  similarity: number;
  compositeScore: number;
}

export interface VectorEmbeddingProvider {
  embed(text: string): Promise<number[]> | number[];
}

export interface PrunedSemanticContext {
  relevantCharacters: CharacterRecord[];
  relevantProps: KeyPropRecord[];
  relevantLocations: LocationRecord[];
  relevantSummaries: EpisodeSummaryRecord[];
  relevantRules: string[];
  relevantBeats: StoryBeatRecord[];
  totalRetrievedItems: number;
  estimatedTokens: number;
  scores: Array<{ id: string; type: SemanticEntityType; score: number }>;
}

export interface QueryOptions {
  topK?: number;
  minSimilarity?: number;
  filterTypes?: SemanticEntityType[];
  currentEpisode?: number;
}

/**
 * High-performance 128-D local semantic vectorizer for zero-dependency offline embedding.
 * Uses subword n-gram hashing and term-frequency projection with L2 unit normalization.
 */
export class LocalSemanticVectorizer {
  public static readonly DEFAULT_DIMENSIONS = 128;
  public static readonly CINEMA_512D_DIMENSIONS = 512;
  public static readonly DIMENSIONS = 128;

  /**
   * Generates a 32-bit FNV-1a hash of a token string.
   */
  private static fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /**
   * Tokenizes text into word tokens and character 3-grams, preserving Vietnamese Unicode characters.
   */
  public static tokenize(text: string): string[] {
    const normalized = text.toLowerCase().normalize("NFC");
    // Extract alphanumeric words including Unicode letters
    const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
    const tokens: string[] = [...words];

    // Add character 3-grams for robust fuzzy/subword matching across morphology
    for (const word of words) {
      if (word.length >= 3) {
        for (let i = 0; i <= word.length - 3; i++) {
          tokens.push(word.slice(i, i + 3));
        }
      }
    }

    return tokens;
  }

  /**
   * Computes a normalized embedding vector from text (128-D default or 512-D high-resolution).
   */
  public static embed(text: string, dimensions = LocalSemanticVectorizer.DIMENSIONS): Float32Array {
    const dim = dimensions > 0 ? dimensions : LocalSemanticVectorizer.DIMENSIONS;
    const vector = new Float32Array(dim);
    const tokens = LocalSemanticVectorizer.tokenize(text);

    if (tokens.length === 0) {
      return vector;
    }

    for (const token of tokens) {
      const h = LocalSemanticVectorizer.fnv1a(token);
      const index = h % dim;
      // Feature sign hashing: odd hashes add +1, even hashes add -1
      const sign = (h & 0x10000) === 0 ? 1.0 : -1.0;
      vector[index] += sign;
    }

    // L2 Normalization so cosine similarity is simply the dot product
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += vector[i] * vector[i];
    }

    norm = Math.sqrt(norm);
    if (norm > 0) {
      const invNorm = 1.0 / norm;
      for (let i = 0; i < dim; i++) {
        vector[i] *= invNorm;
      }
    }

    return vector;
  }

  /**
   * Computes cosine similarity between two unit-normalized vectors: dot product.
   */
  public static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
    }
    // Clamp to [0, 1] for positive similarity ranking
    return Math.max(0, Math.min(1, dot));
  }
}

/**
 * Deep Semantic Vector Memory Engine.
 * Indexes Story Bible entities and performs dynamic context pruning for long-running series.
 */
export class SemanticMemoryEngine {
  private items: Map<string, SemanticMemoryItem> = new Map();
  private externalProvider?: VectorEmbeddingProvider;
  private previousItems=new Map<string,SemanticMemoryItem>();
  public cacheHits=0;

  constructor(options?: { externalProvider?: VectorEmbeddingProvider }) {
    this.externalProvider = options?.externalProvider;
  }

  /**
   * Generates vector embedding using external provider or local vectorizer fallback.
   */
  public async getEmbedding(text: string): Promise<Float32Array> {
    if (this.externalProvider) {
      const raw = await Promise.resolve(this.externalProvider.embed(text));
      const arr = new Float32Array(raw);
      // Ensure unit norm
      let norm = 0;
      for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < arr.length; i++) arr[i] /= norm;
      }
      return arr;
    }
    return LocalSemanticVectorizer.embed(text);
  }

  /**
   * Synchronous embedding using local vectorizer.
   */
  public embedSync(text: string): Float32Array {
    return LocalSemanticVectorizer.embed(text);
  }

  /**
   * Adds or updates a semantic memory item.
   */
  public addItem(item: Omit<SemanticMemoryItem, "vector"> & { vector?: Float32Array }): void {
    const previous=this.previousItems.get(item.id);
    const vector = item.vector ?? (previous?.text===item.text?previous.vector:this.embedSync(item.text));
    this.items.set(item.id, {
      ...item,
      vector,
    });
  }

  /**
   * Clears all indexed items.
   */
  public clear(): void {
    this.items.clear();
  }

  /**
   * Returns total count of indexed items.
   */
  public size(): number {
    return this.items.size;
  }

  /**
   * Automatically indexes all Story Bible entities up to the specified episode.
   */
  public indexStoryBible(
    bible: SemanticMemoryStore,
    seriesId: string,
    currentEpisode: number = 1
  ): number {
    const repository=bible;
    const persistent=process.env.SEMANTIC_CACHE!=="0"&&bible.getDbPath()!==":memory:"&&!this.externalProvider;
    const scope=`${seriesId}:${currentEpisode}:local-fnv128-v2`;
    const sourceRevision=bible.listSourceWorks(seriesId).map(source=>[source.id,source.current_revision]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    const key=`semantic:${scope}:${repository.getRevision()}:${JSON.stringify(sourceRevision)}`;
    const restore=(payload:string)=>{const items=JSON.parse(payload) as Array<Omit<SemanticMemoryItem,"vector">&{vector:number[]}>;return new Map(items.map(item=>[item.id,{...item,vector:new Float32Array(item.vector)}]));};
    const cached=persistent?repository.getIndex(key):null;
    if(cached){try{this.items=restore(cached);this.cacheHits++;return this.items.size;}catch (caughtError) { log.warn("[semantic-memory] "+String(caughtError)); }}
    const previous=persistent?repository.getIndex(`latest:${scope}`):null;
    try{this.previousItems=previous?restore(previous):this.items;}catch{this.previousItems=new Map();}
    this.items=new Map();

    // 1. Characters
    const characters = bible.listCharactersForEpisode(seriesId,currentEpisode);
    for (const char of characters) {
      // Gather known facts up to currentEpisode
      const knowledge = bible.getCharacterKnowledge
        ? bible.getCharacterKnowledge(char.id, currentEpisode)
        : [];
      const knowledgeText = knowledge.map((k) => k.fact_key).join(", ");

      const charText = [
        `Nhân vật: ${char.name}`,
        `Vai trò: ${char.role}`,
        `Trạng thái: ${char.status}`,
        `Đặc điểm ngoại hình: ${char.visual_summary || ""}`,
        `Tính cách: ${(char.personality_traits || []).join(", ")}`,
        knowledgeText ? `Kiến thức nắm giữ: ${knowledgeText}` : "",
      ]
        .filter(Boolean)
        .join(". ");

      const importance = char.role === "protagonist" ? 0.95 : char.role === "antagonist" ? 0.9 : 0.6;

      this.addItem({
        id: `char_${char.id}`,
        entityType: "character",
        entityId: char.id,
        text: charText,
        importance,
        metadata: { character: char },
      });
    }

    // 2. Key Props
    const props = bible.listKeyPropsForEpisode(seriesId,currentEpisode);
    for (const prop of props) {
      const propText = [
        `Đạo cụ: ${prop.name}`,
        `Mô tả: ${prop.visual_summary || prop.description || ""}`,
        prop.current_holder_id ? `Người giữ hiện tại: ${prop.current_holder_id}` : "Chưa có ai giữ",
      ]
        .filter(Boolean)
        .join(". ");

      this.addItem({
        id: `prop_${prop.id}`,
        entityType: "prop",
        entityId: prop.id,
        text: propText,
        importance: 0.8,
        metadata: { prop },
      });
    }

    // 3. Locations
    const locations = bible.listLocations(seriesId);
    for (const loc of locations) {
      const locText = [
        `Địa điểm: ${loc.name}`,
        `Mô tả thị giác: ${loc.visual_summary || ""}`,
        `Không khí ánh sáng: ${loc.lighting_mood || ""}`,
      ]
        .filter(Boolean)
        .join(". ");

      this.addItem({
        id: `loc_${loc.id}`,
        entityType: "location",
        entityId: loc.id,
        text: locText,
        importance: 0.6,
        metadata: { location: loc },
      });
    }

    // 4. World State & Canon Rules
    const worldState = bible.getWorldStateForEpisode(seriesId,currentEpisode);
    if (worldState) {
      for (const [key, val] of Object.entries(worldState)) {
        const text = `Quy tắc thế giới: ${key} = ${typeof val === "object" ? JSON.stringify(val) : String(val)}`;
        this.addItem({
          id: `rule_${key}`,
          entityType: "world_rule",
          entityId: key,
          text,
          importance: 0.75,
          metadata: { ruleKey: key, ruleValue: val },
        });
      }
    }

    // 5. Episode Summaries (prior episodes)
    const summaries = bible.listEpisodeSummaries ? bible.listEpisodeSummaries(seriesId) : [];
    for (const sum of summaries) {
      if (sum.episode_number < currentEpisode) {
        const sumText = [
          `Tóm tắt Tập ${sum.episode_number}: ${sum.title || ""}`,
          `Logline: ${sum.logline || ""}`,
          `Sự kiện chính: ${(sum.major_events || []).join("; ")}`,
        ]
          .filter(Boolean)
          .join(". ");

        // More recent episodes receive slightly higher temporal recency importance
        const recencyDiscount = Math.max(0.5, 1.0 - (currentEpisode - sum.episode_number) * 0.05);

        this.addItem({
          id: `summary_ep_${sum.episode_number}`,
          entityType: "episode_summary",
          entityId: String(sum.episode_number),
          text: sumText,
          importance: 0.7 * recencyDiscount,
          episodeScope: { introducedIn: sum.episode_number },
          metadata: { summary: sum },
        });
      }
    }

    // 6. Story Beats
    const plan=bible.getActiveSeriesPlan(seriesId);
    const assignments=plan?bible.listCoverageLedgers(plan.id):[];
    const futureBeatIds=new Set(assignments.filter(item=>(item.episode_number??0)>currentEpisode).flatMap(item=>[item.beat_id,item.mandatory_beat_id].filter((id):id is string=>Boolean(id))));
    for(const item of assignments.filter(item=>(item.episode_number??0)<=currentEpisode))for(const id of [item.beat_id,item.mandatory_beat_id])if(id)futureBeatIds.delete(id);
    const beats = (bible.listStoryBeats ? bible.listStoryBeats(seriesId) : []).filter(beat=>!futureBeatIds.has(beat.id));
    for (const beat of beats) {
      const beatText = `Nhịp truyện ${beat.id}: ${beat.name}. ${beat.description}`;
      this.addItem({
        id: `beat_${beat.id}`,
        entityType: "story_beat",
        entityId: beat.id,
        text: beatText,
        importance: beat.is_mandatory ? 0.9 : 0.5,
        metadata: { beat },
      });
    }

    if(persistent){const payload=JSON.stringify([...this.items.values()].map(item=>({...item,vector:Array.from(item.vector)})));repository.putIndex(key,payload);repository.putIndex(`latest:${scope}`,payload);}
    this.previousItems.clear();return this.items.size;
  }

  /**
   * Queries top-K most semantically relevant items matching the query text.
   */
  public queryRelevant(queryText: string, options?: QueryOptions): QueryResultItem[] {
    const topK = options?.topK ?? 10;
    const minSim = options?.minSimilarity ?? 0.15;
    const filterTypes = options?.filterTypes;
    const currentEp = options?.currentEpisode;

    const queryVec = this.embedSync(queryText);
    const scored: QueryResultItem[] = [];

    for (const item of this.items.values()) {
      if (filterTypes && !filterTypes.includes(item.entityType)) {
        continue;
      }

      if (currentEp !== undefined && item.episodeScope) {
        if (item.episodeScope.introducedIn > currentEp) {
          // Future unrevealed knowledge
          continue;
        }
        if (item.episodeScope.deprecatedIn && item.episodeScope.deprecatedIn <= currentEp) {
          continue;
        }
      }

      const similarity = LocalSemanticVectorizer.cosineSimilarity(queryVec, item.vector);
      if (similarity < minSim) {
        continue;
      }

      // Composite score = 70% semantic relevance + 30% intrinsic entity importance
      const compositeScore = similarity * 0.7 + item.importance * 0.3;

      const result={
        ...item,
        similarity,
        compositeScore,
      };
      const order=(a:QueryResultItem,b:QueryResultItem)=>b.compositeScore-a.compositeScore||a.id.localeCompare(b.id);
      let low=0,high=scored.length;
      while(low<high){const mid=(low+high)>>>1;if(order(result,scored[mid])<0)high=mid;else low=mid+1;}
      scored.splice(low,0,result);if(scored.length>topK)scored.pop();
    }

    // Sort descending by composite score
    return scored;
  }

  /**
   * Dynamically prunes Story Bible knowledge for the current episode scene,
   * retaining only items that fit into the allocated token budget.
   */
  public pruneContextForEpisode(
    sceneSynopsis: string,
    allCharacters: CharacterRecord[],
    allProps: KeyPropRecord[],
    allLocations: LocationRecord[],
    tokenBudget: number = 3000,
    options?: { currentEpisode?: number }
  ): PrunedSemanticContext {
    // Character budget: estimate ~50 tokens per character, ~30 per prop/rule
    const queryResults = this.queryRelevant(sceneSynopsis, {
      topK: 25,
      minSimilarity: 0.12,
      currentEpisode: options?.currentEpisode,
    });

    const relevantCharIds = new Set<string>();
    const relevantPropIds = new Set<string>();
    const relevantLocIds = new Set<string>();
    const relevantSummaries: EpisodeSummaryRecord[] = [];
    const relevantRules: string[] = [];
    const relevantBeats: StoryBeatRecord[] = [];
    const scores: Array<{ id: string; type: SemanticEntityType; score: number }> = [];

    let estimatedTokens = 0;
    const includedRuleIds = new Set<string>();

    // Canon rules are hard constraints, so retain them even when the local lexical
    // vectorizer cannot infer a synonym (for example, "reactor" vs. a state key).
    const canonicalRules = Array.from(this.items.values())
      .filter((item) => item.entityType === "world_rule")
      .sort((a, b) => b.importance - a.importance);
    for (const rule of canonicalRules) {
      const itemTokens = Math.ceil(rule.text.length / 3.5);
      relevantRules.push(rule.text);
      includedRuleIds.add(rule.id);
      estimatedTokens += itemTokens;
      scores.push({ id: rule.id, type: rule.entityType, score: rule.importance });
    }

    const mandatoryBeats=[...this.items.values()].filter(item=>item.entityType==="story_beat"&&item.metadata?.beat?.is_mandatory);
    for(const item of mandatoryBeats){relevantBeats.push(item.metadata!.beat);estimatedTokens+=Math.ceil(item.text.length/3.5);scores.push({id:item.id,type:item.entityType,score:item.importance});}

    for (const res of queryResults) {
      if (res.entityType === "world_rule" && includedRuleIds.has(res.id)) continue;
      if(res.entityType==="story_beat"&&res.metadata?.beat?.is_mandatory)continue;
      // Rough token estimation: length / 3.5
      const itemTokens = Math.ceil(res.text.length / 3.5);
      if (estimatedTokens + itemTokens > tokenBudget) {
        // Stop if budget is reached
        continue;
      }

      estimatedTokens += itemTokens;
      scores.push({ id: res.id, type: res.entityType, score: res.compositeScore });

      if (res.entityType === "character") {
        relevantCharIds.add(res.entityId);
      } else if (res.entityType === "prop") {
        relevantPropIds.add(res.entityId);
      } else if (res.entityType === "location") {
        relevantLocIds.add(res.entityId);
      } else if (res.entityType === "episode_summary" && res.metadata?.summary) {
        relevantSummaries.push(res.metadata.summary);
      } else if (res.entityType === "world_rule") {
        relevantRules.push(res.text);
      } else if (res.entityType === "story_beat" && res.metadata?.beat) {
        relevantBeats.push(res.metadata.beat);
      }
    }

    // Always include protagonist even if score is slightly lower to guarantee narrative anchor
    const protagonist = allCharacters.find((c) => c.role === "protagonist" && c.status !== "deceased");
    if (protagonist && !relevantCharIds.has(protagonist.id)) {
      relevantCharIds.add(protagonist.id);
    }

    const filteredCharacters = allCharacters.filter((c) => relevantCharIds.has(c.id));
    const filteredProps = allProps.filter((p) => relevantPropIds.has(p.id));
    const filteredLocations = allLocations.filter((l) => relevantLocIds.has(l.id));

    return {
      relevantCharacters: filteredCharacters,
      relevantProps: filteredProps,
      relevantLocations: filteredLocations,
      relevantSummaries,
      relevantRules,
      relevantBeats,
      totalRetrievedItems: queryResults.length,
      estimatedTokens,
      scores,
    };
  }
}
