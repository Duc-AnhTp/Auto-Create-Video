/**
 * Vietnamese Phonetic Normalizer for Tech Text-to-Speech (TTS).
 *
 * Solves common TTS mispronunciations in Vietnamese news:
 * - Version numbers ("GPT 5.5" -> "GPT năm chấm năm", not "năm rưỡi")
 * - Percentage & decimals ("82.7%" -> "tám mươi hai phẩy bảy phần trăm")
 * - Tech specs ("5000mAh" -> "năm nghìn mi li am pe giờ", "200MP", "128GB", "4K")
 * - Currency ("$500" -> "năm trăm đô la", "$5 tỷ" -> "năm tỷ đô la")
 * - Multipliers ("2x" -> "gấp hai lần", "1.5x" -> "gấp một phẩy năm lần")
 * - Tech acronyms and brands ("AI" -> "ây ai", "API" -> "ây pi ai", "GPT" -> "gí pi tí")
 */

// ── Vietnamese Number Words ──────────────────────────────────────────────────
const DIGITS: Record<string, string> = {
  "0": "không",
  "1": "một",
  "2": "hai",
  "3": "ba",
  "4": "bốn",
  "5": "năm",
  "6": "sáu",
  "7": "bảy",
  "8": "tám",
  "9": "chín",
};

/**
 * Converts integers from 0 to 999,999,999 to natural Vietnamese words.
 */
export function integerToVietnamese(num: number): string {
  if (num < 0) return `âm ${integerToVietnamese(Math.abs(num))}`;
  if (num < 10) return DIGITS[String(num)];

  if (num < 20) {
    if (num === 10) return "mười";
    if (num === 15) return "mười lăm";
    return `mười ${DIGITS[String(num % 10)]}`;
  }

  if (num < 100) {
    const tens = Math.floor(num / 10);
    const units = num % 10;
    const tensWord = tens === 1 ? "mười" : `${DIGITS[String(tens)]} mươi`;
    if (units === 0) return tensWord;
    if (units === 1) return tens === 1 ? "mười một" : `${tensWord} mốt`;
    if (units === 4) return tens === 1 ? "mười bốn" : `${tensWord} tư`;
    if (units === 5) return `${tensWord} lăm`;
    return `${tensWord} ${DIGITS[String(units)]}`;
  }

  if (num < 1000) {
    const hundreds = Math.floor(num / 100);
    const remainder = num % 100;
    const hundredsWord = `${DIGITS[String(hundreds)]} trăm`;
    if (remainder === 0) return hundredsWord;
    if (remainder < 10) return `${hundredsWord} lẻ ${DIGITS[String(remainder)]}`;
    return `${hundredsWord} ${integerToVietnamese(remainder)}`;
  }

  if (num < 1000000) {
    const thousands = Math.floor(num / 1000);
    const remainder = num % 1000;
    const thousandsWord = `${integerToVietnamese(thousands)} nghìn`;
    if (remainder === 0) return thousandsWord;
    if (remainder < 100) return `${thousandsWord} không trăm ${remainder < 10 ? "lẻ " : ""}${integerToVietnamese(remainder)}`;
    return `${thousandsWord} ${integerToVietnamese(remainder)}`;
  }

  if (num < 1000000000) {
    const millions = Math.floor(num / 1000000);
    const remainder = num % 1000000;
    const millionsWord = `${integerToVietnamese(millions)} triệu`;
    if (remainder === 0) return millionsWord;
    if (remainder < 1000) {
      if (remainder < 10) return `${millionsWord} không trăm nghìn không trăm lẻ ${integerToVietnamese(remainder)}`;
      if (remainder < 100) return `${millionsWord} không trăm nghìn không trăm ${integerToVietnamese(remainder)}`;
      return `${millionsWord} không trăm nghìn ${integerToVietnamese(remainder)}`;
    }
    if (remainder < 10000) {
      return `${millionsWord} không trăm lẻ ${integerToVietnamese(remainder)}`;
    }
    if (remainder < 100000) {
      return `${millionsWord} không trăm ${integerToVietnamese(remainder)}`;
    }
    return `${millionsWord} ${integerToVietnamese(remainder)}`;
  }

  if (num < 1000000000000) {
    const billions = Math.floor(num / 1000000000);
    const remainder = num % 1000000000;
    const billionsWord = `${integerToVietnamese(billions)} tỷ`;
    if (remainder === 0) return billionsWord;
    if (remainder < 1000) {
      if (remainder < 10) return `${billionsWord} không trăm triệu không trăm nghìn không trăm lẻ ${integerToVietnamese(remainder)}`;
      if (remainder < 100) return `${billionsWord} không trăm triệu không trăm nghìn không trăm ${integerToVietnamese(remainder)}`;
      return `${billionsWord} không trăm triệu không trăm nghìn ${integerToVietnamese(remainder)}`;
    }
    if (remainder < 1000000) {
      return `${billionsWord} không trăm triệu ${integerToVietnamese(remainder)}`;
    }
    if (remainder < 10000000) {
      return `${billionsWord} không trăm lẻ ${integerToVietnamese(remainder)}`;
    }
    if (remainder < 100000000) {
      return `${billionsWord} không trăm ${integerToVietnamese(remainder)}`;
    }
    return `${billionsWord} ${integerToVietnamese(remainder)}`;
  }

  return String(num);
}

// ── Tech Lexicon Map ─────────────────────────────────────────────────────────
export const TECH_LEXICON: Record<string, string> = {
  AI: "ây ai",
  API: "ây pi ai",
  LLM: "eo eo em",
  LLMs: "eo eo em",
  GPU: "gờ pơ u",
  GPUs: "gờ pơ u",
  CPU: "xê pơ u",
  CPUs: "xê pơ u",
  RAM: "ram",
  ROM: "rom",
  SSD: "ét ét đê",
  NPU: "en pơ u",
  SoC: "ét ô xê",
  IoT: "ai ô ti",
  SaaS: "sát",
  OS: "ô ét",
  iOS: "ai ô ét",
  macOS: "mác ô ét",
  WiFi: "oai phai",
  Wifi: "oai phai",
  WIFI: "oai phai",
  Bluetooth: "bu lu tút",
  GPT: "gí pi tí",
  ChatGPT: "chát gí pi tí",
  OpenAI: "Open ây ai",
  DeepSeek: "Đíp xích",
  Claude: "Clo đờ",
  Nvidia: "En vi đi a",
  NVIDIA: "En vi đi a",
  Intel: "In ten",
  AMD: "A mờ đê",
  Qualcomm: "Quoa com",
  Snapdragon: "Snáp đờ ra gần",
  Benchmark: "bénch mác",
  Chipset: "chíp sét",
  Smartphone: "sờ mát phôn",
};

// Precompile regexes for performance
const COMPILED_TECH_LEXICON: Array<{ regex: RegExp; phonetic: string }> = Object.entries(
  TECH_LEXICON
).map(([term, phonetic]) => ({
  regex: new RegExp(`\\b${term}\\b`, "g"),
  phonetic,
}));

/**
 * Converts a numeric or decimal string to Vietnamese words
 */
function convertNumberOrDecimal(numStr: string): string {
  // Check for dot-separated thousands like "10.000" or "1.500.000"
  if (/^\d{1,3}(?:\.\d{3})+$/.test(numStr)) {
    const rawNumber = parseInt(numStr.replace(/\./g, ""), 10);
    if (!isNaN(rawNumber)) {
      return integerToVietnamese(rawNumber);
    }
  }
  // Check for comma-separated thousands like "10,000" or "1,500,000"
  if (/^\d{1,3}(?:,\d{3})+$/.test(numStr)) {
    const rawNumber = parseInt(numStr.replace(/,/g, ""), 10);
    if (!isNaN(rawNumber)) {
      return integerToVietnamese(rawNumber);
    }
  }
  const cleanStr = numStr.replace(",", ".");
  if (cleanStr.includes(".")) {
    const [intPart, decPart] = cleanStr.split(".");
    const intVal = parseInt(intPart, 10);
    const intWords = !isNaN(intVal) ? integerToVietnamese(intVal) : intPart;
    const decWords = decPart.split("").map((d: string) => DIGITS[d] ?? d).join(" ");
    return `${intWords} phẩy ${decWords}`;
  }
  const val = parseInt(cleanStr, 10);
  return !isNaN(val) ? integerToVietnamese(val) : cleanStr;
}

/**
 * Normalizes Vietnamese formatted thousand separators (e.g. "10.000" -> "mười nghìn", "1.500.000" -> "một triệu năm trăm nghìn")
 * before decimal rules run.
 */
function normalizeThousandSeparators(text: string): string {
  // Matches dot-separated groups of exactly 3 digits (e.g. 10.000, 1.500.000, 2.200.000, 1.000.000.000)
  // Negative lookahead (?!\.\d) and negative lookbehind (?<![\d.]) ensure we do not match IP addresses
  // (e.g. 192.168.1.1) or semver version strings (e.g. 1.200.300.4).
  return text.replace(/(?<![\d.])\b\d{1,3}(?:\.\d{3})+\b(?!\.\d)/g, (match) => {
    const rawNumber = parseInt(match.replace(/\./g, ""), 10);
    if (!isNaN(rawNumber)) {
      return integerToVietnamese(rawNumber);
    }
    return match;
  });
}

/**
 * Normalizes decimal version numbers (e.g. "5.5" -> "năm chấm năm", "18.2" -> "mười tám chấm hai")
 */
function normalizeDecimalsAndVersions(text: string): string {
  // Negative lookahead (?!\.\d) and negative lookbehind (?<![\d.]) ensure we do not match IP addresses
  // (e.g. 192.168.1.1, 8.8.8.8) or multi-dot semver strings (e.g. 1.2.3).
  return text.replace(/(?<![\d.])\b(\d+)\.(\d+)\b(?!\.\d)/g, (_match, intPart, decPart) => {
    const intVal = parseInt(intPart, 10);
    const intWords = !isNaN(intVal) ? integerToVietnamese(intVal) : intPart;

    let decWords: string;
    if (decPart.length === 1) {
      decWords = DIGITS[decPart] ?? decPart;
    } else {
      decWords = decPart.split("").map((d: string) => DIGITS[d] ?? d).join(" ");
    }
    return `${intWords} chấm ${decWords}`;
  });
}

/**
 * Normalizes percentages (e.g. "82.7%" or "82,7%" -> "tám mươi hai phẩy bảy phần trăm", "50%" -> "năm mươi phần trăm", "1.500%" -> "một nghìn năm trăm phần trăm")
 */
function normalizePercentages(text: string): string {
  return text.replace(/(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*%/g, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} phần trăm`;
  });
}

/**
 * Normalizes specs & units (GB, TB, mAh, MP, nm, Hz, Ghz, x, 4K, 8K)
 */
function normalizeTechSpecs(text: string): string {
  let res = text;

  // Video resolution: 4K, 8K, 1080p
  res = res.replace(/\b4K\b/gi, "bốn ca");
  res = res.replace(/\b8K\b/gi, "tám ca");
  res = res.replace(/\b1080p\b/gi, "một không tám không pê");

  // Battery: 5000mAh / 5000 mAh / 10.000mAh / 4500.5mAh
  res = res.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*mAh\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} mi li am pe giờ`;
  });

  // Storage: GB, TB, MB
  res = res.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*GB\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} ghi ga bai`;
  });
  res = res.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*TB\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} tê ra bai`;
  });
  res = res.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*MB\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} mê ga bai`;
  });

  // Camera: 200MP / 48MP / 48.5MP
  res = res.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*MP\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} mê ga píc xen`;
  });

  // Chip fabrication: 3nm, 2nm, 1.8nm
  res = res.replace(/\b(\d+(?:[.,]\d+)?)\s*nm\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} na nô mét`;
  });

  // Multiplier: 2x, 1.5x, 10x, "gấp 2x", "gấp 1.5x" -> "gấp ... lần" (prevents duplicate "gấp")
  // Lookahead (?![0-9a-zA-Z\p{L}]|\s*\d) and requiring no space before 'x' ensures we do not match
  // screen resolutions (1920x1080, 1920 x 1080) or dimensions (3x4, 100 x 200 mm)
  // or Vietnamese words starting with x ("xách", "xưởng")
  res = res.replace(/(?:gấp\s+)?\b(\d+(?:[.,]\d+)?)x(?![0-9a-zA-Z\p{L}]|\s*\d)/giu, (_match, numStr) => {
    return `gấp ${convertNumberOrDecimal(numStr)} lần`;
  });

  // Frequency: 120Hz, 3.2GHz, 800MHz, 2.4GHz
  res = res.replace(/\b(\d+(?:[.,]\d+)?)\s*GHz\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} ghi ga héc`;
  });
  res = res.replace(/\b(\d+(?:[.,]\d+)?)\s*MHz\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} mê ga héc`;
  });
  res = res.replace(/\b(\d+(?:[.,]\d+)?)\s*kHz\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} ki lô héc`;
  });
  res = res.replace(/\b(\d+(?:[.,]\d+)?)\s*Hz\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} héc`;
  });

  return res;
}

/**
 * Normalizes currency like "$5", "$500", "$9.99", "$5.5", "$5 tỷ", "$10.000", "$10,000", "$5K", "500 USD"
 */
function normalizeCurrency(text: string): string {
  let res = text;

  // Large scale currency with Vietnamese words: $5 tỷ / $10 triệu / $500 nghìn
  // Use (?![a-zA-Z\p{L}]) instead of \b to properly handle Unicode letters like 'ỷ'
  res = res.replace(/\$(\d+(?:[.,]\d+)?)\s*tỷ(?![a-zA-Z\p{L}])/giu, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} tỷ đô la`;
  });
  res = res.replace(/\$(\d+(?:[.,]\d+)?)\s*triệu(?![a-zA-Z\p{L}])/giu, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} triệu đô la`;
  });
  res = res.replace(/\$(\d+(?:[.,]\d+)?)\s*(?:nghìn|ngàn)(?![a-zA-Z\p{L}])/giu, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} nghìn đô la`;
  });

  // Uppercase letter abbreviations: $5B / $5M (case-sensitive to avoid matching lowercase 'm' in 'một tháng')
  res = res.replace(/\$(\d+(?:[.,]\d+)?)\s*B(?![a-zA-Z\p{L}])/gu, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} tỷ đô la`;
  });
  res = res.replace(/\$(\d+(?:[.,]\d+)?)\s*M(?![a-zA-Z\p{L}])/gu, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} triệu đô la`;
  });

  // Thousands abbreviation: $5K / $5k / $10k
  res = res.replace(/\$(\d+(?:[.,]\d+)?)\s*k(?![a-zA-Z\p{L}])/giu, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} nghìn đô la`;
  });

  // Comma-separated currency: $10,000, $1,500,000
  res = res.replace(/\$(\d{1,3}(?:,\d{3})+)\b/g, (_match, numStr) => {
    const rawNumber = parseInt(numStr.replace(/,/g, ""), 10);
    const words = !isNaN(rawNumber) ? integerToVietnamese(rawNumber) : numStr;
    return `${words} đô la`;
  });

  // Thousand-separated currency: $10.000, $1.500.000
  res = res.replace(/\$(\d{1,3}(?:\.\d{3})+)\b/g, (_match, numStr) => {
    const rawNumber = parseInt(numStr.replace(/\./g, ""), 10);
    const words = !isNaN(rawNumber) ? integerToVietnamese(rawNumber) : numStr;
    return `${words} đô la`;
  });

  // Standard / Decimal USD: $500, $9.99, $5.5
  res = res.replace(/\$(\d+(?:[.,]\d+)?)/g, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} đô la`;
  });

  // Suffix USD with comma or dot: 10,000 USD or 10.000 USD
  res = res.replace(/\b(\d{1,3}(?:[.,]\d{3})+)\s*USD\b/gi, (_match, numStr) => {
    const rawNumber = parseInt(numStr.replace(/[.,]/g, ""), 10);
    const words = !isNaN(rawNumber) ? integerToVietnamese(rawNumber) : numStr;
    return `${words} đô la`;
  });

  // Suffix USD (remaining simple integers and decimals): 500 USD, 9.99 USD
  res = res.replace(/\b(\d+(?:[.,]\d+)?)\s*USD\b/gi, (_match, numStr) => {
    return `${convertNumberOrDecimal(numStr)} đô la`;
  });

  return res;
}

/**
 * Normalizes symbols and punctuation for natural TTS intonation
 */
function normalizeSymbols(text: string): string {
  let res = text;
  res = res.replace(/&/g, " và ");
  res = res.replace(/\+/g, " cộng ");
  res = res.replace(/→|->/g, " chuyển sang ");
  // Support Unicode letters in hashtags like #độtphá, #côngnghệ, #AI
  res = res.replace(/#([\p{L}\p{N}_]+)/gu, "$1");
  res = res.replace(/\s+/g, " ").trim();
  return res;
}

/**
 * Applies Tech Lexicon dictionary replacements
 */
function applyTechLexicon(text: string): string {
  let res = text;
  for (const item of COMPILED_TECH_LEXICON) {
    res = res.replace(item.regex, item.phonetic);
  }
  return res;
}

/**
 * Main function: Normalizes Vietnamese tech text for natural TTS output.
 * Idempotent: can be safely executed multiple times.
 */
export function normalizeVietnameseForTts(text: string): string {
  if (!text || text.trim() === "") return "";

  let result = text;

  // Step 1: Currency ($500, $5 tỷ, $10.000, $10,000, $5K, 100 USD) before generic numbers
  result = normalizeCurrency(result);

  // Step 2: Percentages (82.7%, 82,7%, 1.500%)
  result = normalizePercentages(result);

  // Step 3: Tech Specs (GB, mAh, MP, 4K, multipliers)
  result = normalizeTechSpecs(result);

  // Step 4: Thousand separators (10.000, 1.000.000) for remaining numbers
  result = normalizeThousandSeparators(result);

  // Step 5: Decimal & version numbers (GPT 5.5, iOS 18.2)
  result = normalizeDecimalsAndVersions(result);

  // Step 6: Clean symbols
  result = normalizeSymbols(result);

  // Step 7: Tech Lexicon lookup
  result = applyTechLexicon(result);

  // Final cleanup: ensure single spacing
  result = result.replace(/\s{2,}/g, " ").trim();

  return result;
}
