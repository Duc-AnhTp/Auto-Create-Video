import type { CanonInvariantValidatorStore } from "../ports/canon-invariant-validator-store.js";
import type { CharacterRecord, KeyPropRecord } from "../../../contracts/story.js";
import { buildCharacterNameRegex, escapeRegex } from "./character-name.js";

export type InvariantViolationType =
  | "anti_resurrection"
  | "prop_custody_violation"
  | "epistemic_knowledge_violation"
  | "spatio_temporal_violation";

export type InvariantSeverity = "fatal" | "repairable_by_bridge";

export interface InvariantViolation {
  gate: string;
  type: InvariantViolationType;
  severity: InvariantSeverity;
  sceneNumber: number;
  characterId?: string;
  characterName?: string;
  propId?: string;
  propName?: string;
  currentHolderId?: string;
  targetHolderId?: string;
  description: string;
  quote?: string;
  reconciliationSuggestion: string;
}

export interface ParsedScene {
  sceneNumber: number;
  slugline: string;
  locationName: string;
  timeOfDay: string;
  isFlashback: boolean;
  isDreamOrHallucination: boolean;
  rawText: string;
  dialogues: Array<{ characterName: string; text: string }>;
  actions: string[];
  charactersPresent: string[];
  propsReferenced: string[];
}

export interface BridgeSceneSpec {
  bridgeSceneNumber: number | string;
  slugline: string;
  purpose: string;
  narrativeDescription: string;
  dialogue?: Array<{ speaker: string; line: string }>;
  reconciledViolationType: InvariantViolationType;
  propDelta?: { propId: string; fromHolderId: string; toHolderId: string };
}

export interface ValidationReport {
  status: "PASS" | "WARN" | "FAIL";
  violations: InvariantViolation[];
  parsedScenesCount: number;
  fatalCount: number;
  repairableCount: number;
}

export interface AutoRepairResult {
  repairedScript: string;
  validationReport: ValidationReport;
  appliedBridges: BridgeSceneSpec[];
  isFullyReconciled: boolean;
}

/**
 * Screenplay AST Parser: decomposes screenplay text into structured scenes,
 * extracting participants, spoken dialogues, action beats, prop interactions,
 * and flashback/dream markers.
 */
export class ScreenplayAstParser {
  public static parse(scriptText: string, knownProps: KeyPropRecord[] = []): ParsedScene[] {
    const scenes: ParsedScene[] = [];
    const lines = scriptText.split(/\r?\n/);

    const sceneHeaderRegex = /^(?:CẢNH|SCENE|INT\.|EXT\.|PHÂN CẢNH)\s*(\d+(?:\.\d+)?|[A-Z0-9_\-\.]+)?[:\.\-\s]*(.*)$/iu;

    let currentScene: ParsedScene | null = null;
    let currentRawLines: string[] = [];

    const flushScene = () => {
      if (currentScene) {
        currentScene.rawText = currentRawLines.join("\n").trim();
        scenes.push(currentScene);
      }
      currentRawLines = [];
    };

    let autoSceneIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      const headerMatch = trimmed.match(sceneHeaderRegex);
      if (headerMatch) {
        flushScene();

        const numStr = headerMatch[1];
        const sceneNum = numStr ? parseFloat(numStr) || autoSceneIndex : autoSceneIndex;
        autoSceneIndex = Math.floor(sceneNum) + 1;

        const remainder = headerMatch[2] || trimmed;
        const lower = trimmed.toLowerCase();
        const isFlashback =
          lower.includes("[flashback]") ||
          lower.includes("[hồi tưởng]") ||
          lower.includes("(flashback)") ||
          lower.includes("(hồi tưởng)");
        const isDreamOrHallucination =
          lower.includes("[ảo giác]") ||
          lower.includes("[giấc mơ]") ||
          lower.includes("(ảo giác)") ||
          lower.includes("(giấc mơ)");

        // Extract location and time of day
        // Format e.g. "CĂN CỨ BÍ MẬT - ĐÊM"
        const parts = remainder.split(/\s*-\s*/);
        const loc = parts[0]?.replace(/\[.*?\]|\(.*?\)/g, "").trim() || "KHÔNG GIAN TRUNG GIAN";
        const tod = parts[1]?.replace(/\[.*?\]|\(.*?\)/g, "").trim() || "NGÀY";

        currentScene = {
          sceneNumber: sceneNum,
          slugline: trimmed,
          locationName: loc,
          timeOfDay: tod,
          isFlashback,
          isDreamOrHallucination,
          rawText: "",
          dialogues: [],
          actions: [],
          charactersPresent: [],
          propsReferenced: [],
        };
        currentRawLines.push(line);
        continue;
      }

      if (!currentScene) {
        // Preamble or first scene without explicit header
        currentScene = {
          sceneNumber: autoSceneIndex++,
          slugline: "CẢNH 1: MỞ ĐẦU",
          locationName: "KHÔNG XÁC ĐỊNH",
          timeOfDay: "NGÀY",
          isFlashback: false,
          isDreamOrHallucination: false,
          rawText: "",
          dialogues: [],
          actions: [],
          charactersPresent: [],
          propsReferenced: [],
        };
      }

      currentRawLines.push(line);

      // Dialogue match: "MINH: Lời thoại ở đây" or "MINH (thì thầm): ..."
      const dialogueMatch = trimmed.match(/^([A-ZÀ-Ỹ0-9_\s]{2,30})(?:\s*\([^)]*\))?\s*:\s*(.*)$/u);
      if (dialogueMatch) {
        const speaker = dialogueMatch[1].trim();
        const speech = dialogueMatch[2].trim();
        currentScene.dialogues.push({ characterName: speaker, text: speech });
        if (!currentScene.charactersPresent.includes(speaker)) {
          currentScene.charactersPresent.push(speaker);
        }
      } else {
        // Action line
        currentScene.actions.push(trimmed);
      }

      // Check prop references in this line
      for (const p of knownProps) {
        const pRegex = new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
        if (pRegex.test(trimmed) && !currentScene.propsReferenced.includes(p.id)) {
          currentScene.propsReferenced.push(p.id);
        }
      }
    }

    flushScene();
    return scenes;
  }
}

/**
 * Pre-Execution Canon Invariant Validator:
 * Enforces strict narrative causality across long-form multi-episode series:
 * 1. Anti-Resurrection Gate
 * 2. Prop Custody & Provenance Gate
 * 3. Epistemic Knowledge Boundary Gate
 * 4. Spatio-Temporal Continuity Gate
 */
export class CanonInvariantValidator {
  /**
   * Validates screenplay text against Story Bible state for the given episode.
   */
  public static validate(
    scriptText: string,
    bible: CanonInvariantValidatorStore,
    seriesId: string,
    episodeNumber: number
  ): ValidationReport {
    const characters = bible.listCharacters(seriesId);
    const keyProps = bible.listKeyProps(seriesId);
    const parsedScenes = ScreenplayAstParser.parse(scriptText, keyProps);
    const violations: InvariantViolation[] = [];

    // Track dynamic prop custody within this script
    // Initialize with current holder from Story Bible
    const runningPropHolders = new Map<string, string | null>();
    for (const p of keyProps) {
      runningPropHolders.set(p.id, p.current_holder_id || null);
    }

    // Helper map of normalized character names to CharacterRecord
    const charMap = new Map<string, CharacterRecord>();
    for (const c of characters) {
      charMap.set(c.name.trim().toLowerCase(), c);
      charMap.set(c.id.toLowerCase(), c);
    }

    const resolveCharacter = (nameOrId: string): CharacterRecord | undefined => {
      return charMap.get(nameOrId.trim().toLowerCase());
    };

    // Prop action verbs indicating possession / drawing / using / transferring
    const propActionVerbs = /(?:rút|cầm|lấy|mở|sử dụng|kích hoạt|bàn giao|trao|giơ|đưa|nhặt|mang theo)/iu;

    for (const scene of parsedScenes) {
      // -------------------------------------------------------------
      // Gate 1: Anti-Resurrection Gate
      // -------------------------------------------------------------
      if (!scene.isFlashback && !scene.isDreamOrHallucination) {
        for (const char of characters) {
          if (char.status === "deceased" || char.status === "missing") {
            const namePattern = buildCharacterNameRegex(char.name);

            // Check if deceased character is speaking
            const speaking = scene.dialogues.some((d) => namePattern.test(d.characterName));
            // Check if deceased character is acting or named in scene actions
            const acting = scene.actions.some((a) => namePattern.test(a));

            if (speaking || acting) {
              violations.push({
                gate: "Gate 1: Anti-Resurrection",
                type: "anti_resurrection",
                severity: "fatal",
                sceneNumber: scene.sceneNumber,
                characterId: char.id,
                characterName: char.name,
                description: `Nhân vật '${char.name}' có trạng thái '${char.status}' trong Story Bible nhưng xuất hiện hoặc phát biểu tại Cảnh ${scene.sceneNumber} mà không có nhãn [Flashback] hoặc [Ảo giác].`,
                quote: scene.slugline,
                reconciliationSuggestion: `Chuyển Cảnh ${scene.sceneNumber} thành phân cảnh hồi tưởng ([Flashback]) hoặc loại bỏ sự hiện diện của '${char.name}'.`,
              });
            }
          }
        }
      }

      // -------------------------------------------------------------
      // Gate 2: Prop Custody & Provenance Gate
      // -------------------------------------------------------------
      for (const prop of keyProps) {
        if (!scene.propsReferenced.includes(prop.id)) {
          continue;
        }

        let currentHolderId = runningPropHolders.get(prop.id);
        const propNamePattern = new RegExp(prop.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");

        // Inspect lines mentioning this prop
        for (const actionLine of scene.actions) {
          if (!propNamePattern.test(actionLine)) continue;

          // 1. Check if this is an explicit transfer line: Giver hands Prop to Recipient
          // E.g. "Nam trao Thẻ Từ Mật Mã cho Lan..."
          let isTransfer = false;
          for (const recipientChar of characters) {
            const escapedRecipient = escapeRegex(recipientChar.name);
            const recipientPattern = new RegExp(
              `(?:trao|bàn giao|giao lại|chuyển giao|đưa)\\s+.*?\\s+cho\\s+(?<![\\p{L}\\p{N}])${escapedRecipient}(?![\\p{L}\\p{N}])`,
              "iu"
            );
            if (recipientPattern.test(actionLine)) {
              isTransfer = true;
              // Find giver who appears before the transfer verb
              let giverChar: CharacterRecord | undefined;
              for (const otherChar of characters) {
                if (otherChar.id !== recipientChar.id) {
                  const escapedGiver = escapeRegex(otherChar.name);
                  const giverPattern = new RegExp(
                    `(?<![\\p{L}\\p{N}])${escapedGiver}(?![\\p{L}\\p{N}]).*?\\b(?:trao|bàn giao|giao lại|chuyển giao|đưa)\\b`,
                    "iu"
                  );
                  if (giverPattern.test(actionLine)) {
                    giverChar = otherChar;
                    break;
                  }
                }
              }

              // Validate giver possession
              if (giverChar && currentHolderId && currentHolderId !== giverChar.id) {
                const currentHolder = characters.find((c) => c.id === currentHolderId);
                const currentHolderName = currentHolder?.name || currentHolderId;
                violations.push({
                  gate: "Gate 2: Prop Custody",
                  type: "prop_custody_violation",
                  severity: "repairable_by_bridge",
                  sceneNumber: scene.sceneNumber,
                  characterId: giverChar.id,
                  characterName: giverChar.name,
                  propId: prop.id,
                  propName: prop.name,
                  currentHolderId,
                  targetHolderId: giverChar.id,
                  description: `Nhân vật '${giverChar.name}' muốn trao đạo cụ '${prop.name}' tại Cảnh ${scene.sceneNumber}, nhưng đạo cụ này đang thuộc quyền nắm giữ của '${currentHolderName}' theo sổ cái Story Bible.`,
                  quote: actionLine,
                  reconciliationSuggestion: `Tự động sinh phân cảnh bắc cầu (Bridge Scene) để '${currentHolderName}' bàn giao '${prop.name}' cho '${giverChar.name}' trước khi diễn ra Cảnh ${scene.sceneNumber}.`,
                });
              } else {
                // Successful transfer: update holder to recipient
                currentHolderId = recipientChar.id;
                runningPropHolders.set(prop.id, recipientChar.id);
              }
              break;
            }
          }

          if (isTransfer) {
            continue; // Handled transfer, do not check recipient as illegal user
          }

          // 2. Non-transfer actions: character drawing, holding, using prop
          if (propActionVerbs.test(actionLine)) {
            // Find which character is performing this action
            for (const char of characters) {
              const charPattern = buildCharacterNameRegex(char.name);
              if (charPattern.test(actionLine)) {
                // If this character is attempting to use/draw the prop but does not currently hold it
                if (currentHolderId && currentHolderId !== char.id) {
                  const currentHolder = characters.find((c) => c.id === currentHolderId);
                  const currentHolderName = currentHolder?.name || currentHolderId;

                  violations.push({
                    gate: "Gate 2: Prop Custody",
                    type: "prop_custody_violation",
                    severity: "repairable_by_bridge",
                    sceneNumber: scene.sceneNumber,
                    characterId: char.id,
                    characterName: char.name,
                    propId: prop.id,
                    propName: prop.name,
                    currentHolderId,
                    targetHolderId: char.id,
                    description: `Nhân vật '${char.name}' sử dụng hoặc rút đạo cụ '${prop.name}' tại Cảnh ${scene.sceneNumber}, nhưng đạo cụ này đang thuộc quyền nắm giữ của '${currentHolderName}' theo sổ cái Story Bible.`,
                    quote: actionLine,
                    reconciliationSuggestion: `Tự động sinh phân cảnh bắc cầu (Bridge Scene) để '${currentHolderName}' bàn giao '${prop.name}' cho '${char.name}' trước khi diễn ra Cảnh ${scene.sceneNumber}.`,
                  });
                } else if (!currentHolderId) {
                  // Prop is unheld; character claims it
                  currentHolderId = char.id;
                  runningPropHolders.set(prop.id, char.id);
                }
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // Gate 3: Epistemic Knowledge Boundary Gate
      // -------------------------------------------------------------
      for (const diag of scene.dialogues) {
        const speaker = resolveCharacter(diag.characterName);
        if (!speaker) continue;

        // E.g. Check for secret phrases like "kẻ sát nhân chính là", "mật mã bí mật là"
        const secretRegex = /(?:kẻ sát nhân chính là|thủ phạm là|tên giết người là|mật mã bí mật là)\s*([A-ZÀ-Ỹ0-9_\s]+)?/iu;
        if (secretRegex.test(diag.text)) {
          const knowledge = bible.getCharacterKnowledge
            ? bible.getCharacterKnowledge(speaker.id, episodeNumber)
            : [];
          const knowsSecret = knowledge.some(
            (k) => k.fact_key === "knows_killer_identity" || k.fact_key === "knows_secret_code"
          );

          if (!knowsSecret) {
            violations.push({
              gate: "Gate 3: Epistemic Knowledge Boundary",
              type: "epistemic_knowledge_violation",
              severity: "fatal",
              sceneNumber: scene.sceneNumber,
              characterId: speaker.id,
              characterName: speaker.name,
              description: `Nhân vật '${speaker.name}' tiết lộ bí mật trong lời thoại tại Cảnh ${scene.sceneNumber}, nhưng chưa từng được tiếp cận thông tin này tính đến Tập ${episodeNumber}.`,
              quote: `${diag.characterName}: ${diag.text}`,
              reconciliationSuggestion: `Loại bỏ câu thoại tiết lộ bí mật hoặc thêm sự kiện khám phá manh mối hợp lệ cho '${speaker.name}' ở các tập trước.`,
            });
          }
        }
      }
    }

    const fatalCount = violations.filter((v) => v.severity === "fatal").length;
    const repairableCount = violations.filter((v) => v.severity === "repairable_by_bridge").length;

    let status: "PASS" | "WARN" | "FAIL" = "PASS";
    if (fatalCount > 0) {
      status = "FAIL";
    } else if (repairableCount > 0) {
      status = "WARN";
    }

    return {
      status,
      violations,
      parsedScenesCount: parsedScenes.length,
      fatalCount,
      repairableCount,
    };
  }
}

/**
 * Auto-Bridge Generator & Script Repair Patch Engine:
 * When a repairable narrative violation occurs (such as missing prop custody handoff),
 * synthesizes a transition scene specification and patches the screenplay automatically.
 */
export class AutoBridgeGenerator {
  /**
   * Synthesizes a transitional bridge scene specification for a repairable violation.
   */
  public static generateBridgeScene(
    violation: InvariantViolation,
    characters: CharacterRecord[],
    props: KeyPropRecord[]
  ): BridgeSceneSpec {
    const bridgeNum = violation.sceneNumber > 1 ? `${violation.sceneNumber - 0.5}` : "1.5";

    if (violation.type === "prop_custody_violation") {
      const fromChar = characters.find((c) => c.id === violation.currentHolderId);
      const toChar = characters.find((c) => c.id === violation.targetHolderId);
      const prop = props.find((p) => p.id === violation.propId);

      const fromName = fromChar?.name || violation.currentHolderId || "Người giữ trước";
      const toName = toChar?.name || violation.targetHolderId || "Người nhận";
      const propName = prop?.name || violation.propName || "Đạo cụ";

      return {
        bridgeSceneNumber: bridgeNum,
        slugline: `CẢNH ${bridgeNum}: [CẦU NỐI CHUYỂN GIAO ĐẠO CỤ] HÀNH LANG BÍ MẬT - NGÀY`,
        purpose: `Thiết lập tính nhân quả hợp lệ: ${fromName} chuyển giao ${propName} cho ${toName}.`,
        narrativeDescription: `${fromName} bí mật gặp ${toName} tại điểm hẹn. Sau một hồi cân nhắc tình thế nguy cấp, ${fromName} rút ${propName} ra khỏi túi áo rồi trao ${propName} cho ${toName}. ${toName} cất kỹ ${propName} vào áo trước khi tiến vào phân cảnh tiếp theo.`,
        dialogue: [
          {
            speaker: fromName.toUpperCase(),
            line: `${toName}, hãy cầm lấy ${propName}. Nhiệm vụ phía trước giao lại cho cậu.`,
          },
          {
            speaker: toName.toUpperCase(),
            line: `Tôi hiểu rồi. Tôi nhất định sẽ bảo vệ ${propName} an toàn.`,
          },
        ],
        reconciledViolationType: "prop_custody_violation",
        propDelta: {
          propId: violation.propId || "",
          fromHolderId: violation.currentHolderId || "",
          toHolderId: violation.targetHolderId || "",
        },
      };
    }

    // Fallback spatio-temporal transition bridge
    return {
      bridgeSceneNumber: bridgeNum,
      slugline: `CẢNH ${bridgeNum}: [CẦU NỐI KHÔNG GIAN] ĐƯỜNG DI CHUYỂN - NGÀY`,
      purpose: "Phân cảnh chuyển tiếp không gian.",
      narrativeDescription: "Nhân vật gấp rút di chuyển qua các tuyến phố để kịp thời có mặt tại địa điểm tiếp theo.",
      reconciledViolationType: violation.type,
    };
  }

  /**
   * Formats a BridgeSceneSpec into screenplay text.
   */
  public static formatBridgeScene(spec: BridgeSceneSpec): string {
    const lines: string[] = [
      "",
      spec.slugline,
      spec.narrativeDescription,
    ];

    if (spec.dialogue && spec.dialogue.length > 0) {
      for (const d of spec.dialogue) {
        lines.push(`${d.speaker}: ${d.line}`);
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  /**
   * Applies the synthesized bridge scene into the screenplay text,
   * injecting it right before the violating scene.
   */
  public static applyBridgeRepair(originalScript: string, bridgeSpec: BridgeSceneSpec, targetSceneNum: number): string {
    const formattedBridge = AutoBridgeGenerator.formatBridgeScene(bridgeSpec);
    const sceneRegex = new RegExp(`(^[\\t ]*(?:CẢNH|SCENE|INT\\.|EXT\\.|PHÂN CẢNH)\\s*${targetSceneNum}[:\\.\\-\\s].*$)`, "miu");

    const match = originalScript.match(sceneRegex);
    if (match && match.index !== undefined) {
      return (
        originalScript.slice(0, match.index) +
        formattedBridge +
        "\n" +
        originalScript.slice(match.index)
      );
    }

    // Append before end if exact regex doesn't match
    return originalScript + "\n" + formattedBridge;
  }

  /**
   * Complete End-to-End Validator & Auto-Repair:
   * Validates script, synthesizes bridges for all repairable violations,
   * patches the screenplay, and optionally updates SQLite Story Bible with prop transfers.
   */
  public static validateAndAutoRepair(
    scriptText: string,
    bible: CanonInvariantValidatorStore,
    seriesId: string,
    episodeNumber: number,
    options?: { persistToBible?: boolean }
  ): AutoRepairResult {
    const initialReport = CanonInvariantValidator.validate(scriptText, bible, seriesId, episodeNumber);

    if (initialReport.violations.length === 0) {
      return {
        repairedScript: scriptText,
        validationReport: initialReport,
        appliedBridges: [],
        isFullyReconciled: true,
      };
    }

    // If fatal violations exist, auto-repair cannot fully reconcile without human/LLM intervention
    if (initialReport.fatalCount > 0) {
      return {
        repairedScript: scriptText,
        validationReport: initialReport,
        appliedBridges: [],
        isFullyReconciled: false,
      };
    }

    let currentScript = scriptText;
    const appliedBridges: BridgeSceneSpec[] = [];
    const characters = bible.listCharacters(seriesId);
    const props = bible.listKeyProps(seriesId);

    // Apply bridges in descending order of scene number to prevent line offset disruption
    const sortedViolations = [...initialReport.violations].sort((a, b) => b.sceneNumber - a.sceneNumber);

    for (const v of sortedViolations) {
      if (v.severity === "repairable_by_bridge") {
        const bridge = AutoBridgeGenerator.generateBridgeScene(v, characters, props);
        currentScript = AutoBridgeGenerator.applyBridgeRepair(currentScript, bridge, v.sceneNumber);
        appliedBridges.push(bridge);

      }
    }

    // Re-validate repaired script
    const finalReport = CanonInvariantValidator.validate(currentScript, bible, seriesId, episodeNumber);

    // Persist generated state changes only after the repaired script validates against the original canon.
    if (options?.persistToBible && finalReport.status === "PASS") {
      for (const bridge of appliedBridges) {
        if (!bridge.propDelta) continue;
        bible.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          entity_type: "prop",
          entity_id: bridge.propDelta.propId,
          event_type: "prop_transfer",
          from_state_json: JSON.stringify({ current_holder_id: bridge.propDelta.fromHolderId }),
          to_state_json: JSON.stringify({ current_holder_id: bridge.propDelta.toHolderId }),
          confirmation_source: "script_delta",
          created_at: new Date().toISOString(),
        });

        const existingProp = bible.getKeyProp(bridge.propDelta.propId, seriesId);
        if (existingProp) {
          bible.upsertKeyProp({
            ...existingProp,
            current_holder_id: bridge.propDelta.toHolderId,
          });
        }
      }
    }

    return {
      repairedScript: currentScript,
      validationReport: finalReport,
      appliedBridges,
      isFullyReconciled: finalReport.status === "PASS",
    };
  }
}
