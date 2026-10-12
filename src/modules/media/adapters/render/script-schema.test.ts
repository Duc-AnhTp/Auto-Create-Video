import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ScriptSchema } from "./script-schema.js";

const load = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/${name}`, "utf8"));

describe("ScriptSchema", () => {
  it("accepts sample-script-with-image.json", () => {
    expect(() => ScriptSchema.parse(load("sample-script-with-image.json"))).not.toThrow();
  });

  it("accepts sample-script-no-image.json", () => {
    expect(() => ScriptSchema.parse(load("sample-script-no-image.json"))).not.toThrow();
  });

  it("rejects invalid-bad-enum.json", () => {
    expect(() => ScriptSchema.parse(load("invalid-bad-enum.json"))).toThrow(/kenBurns/);
  });

  it("rejects invalid-too-many-scenes.json", () => {
    // This fixture has 10 scenes — now valid with max=30.
    // Override to create a script with 31 scenes to test the new limit.
    const data = load("invalid-too-many-scenes.json");
    // Duplicate body scenes to get past 30
    while (data.scenes.length < 31) {
      const clone = { ...data.scenes[1], id: `body-dup-${data.scenes.length}` };
      data.scenes.splice(data.scenes.length - 1, 0, clone);
    }
    expect(() => ScriptSchema.parse(data)).toThrow(/scenes/);
  });

  it("rejects invalid-line-too-long.json", () => {
    // headline is over 80 chars — Zod error references the max value
    expect(() => ScriptSchema.parse(load("invalid-line-too-long.json"))).toThrow();
  });

  it("requires hook + outro present", () => {
    const data = load("sample-script-with-image.json");
    data.scenes = data.scenes.filter((s: any) => s.type !== "outro");
    expect(() => ScriptSchema.parse(data)).toThrow(/outro/);
  });

  it("handles optional voice or defaults speed to 1.0", () => {
    const data = load("sample-script-with-image.json");
    delete data.voice;
    const parsedWithoutVoice = ScriptSchema.parse(data);
    expect(parsedWithoutVoice.voice).toBeUndefined();

    data.voice = {
      provider: "elevenlabs",
      voiceId: "some-voice-id",
    };
    const parsedWithDefaultSpeed = ScriptSchema.parse(data);
    expect(parsedWithDefaultSpeed.voice?.speed).toBe(1.0);
    expect(parsedWithDefaultSpeed.voice?.provider).toBe("elevenlabs");
  });

  it("accepts sample-script-long.json (14 scenes, images, context, chapters)", () => {
    const parsed = ScriptSchema.parse(load("sample-script-long.json"));
    expect(parsed.scenes.length).toBe(14);
    expect(parsed.images.length).toBe(5);
    expect(parsed.context?.tone).toBe("review");
    expect(parsed.context?.keyEntities.length).toBeGreaterThan(0);
    // Verify chapters exist on some scenes
    const withChapters = parsed.scenes.filter((s) => s.chapter);
    expect(withChapters.length).toBeGreaterThan(5);
    // Verify new template types
    const imageCards = parsed.scenes.filter((s) => s.templateData.template === "image-card");
    expect(imageCards.length).toBeGreaterThan(0);
    const splitImages = parsed.scenes.filter((s) => s.templateData.template === "split-image");
    expect(splitImages.length).toBeGreaterThan(0);
    const textReveals = parsed.scenes.filter((s) => s.templateData.template === "text-reveal");
    expect(textReveals.length).toBeGreaterThan(0);
    // Verify transition type
    const transitions = parsed.scenes.filter((s) => s.type === "transition");
    expect(transitions.length).toBeGreaterThan(0);
  });

  it("accepts 3-scene minimal script (new minimum)", () => {
    const data = {
      version: "1.0",
      metadata: {
        title: "Test",
        source: { url: "https://test.com", domain: "test.com", image: null },
        channel: "Test",
      },
      scenes: [
        { id: "h", type: "hook", voiceText: "Hook text.", templateData: { template: "hook", headline: "Test" } },
        { id: "b", type: "body", voiceText: "Body text.", templateData: { template: "callout", statement: "Test statement." } },
        { id: "o", type: "outro", voiceText: "Outro text.", templateData: { template: "outro", ctaTop: "Follow", channelName: "Ch", source: "src.com" } },
      ],
    };
    expect(() => ScriptSchema.parse(data)).not.toThrow();
  });

  it("defaults images to empty array when omitted", () => {
    const data = load("sample-script-with-image.json");
    const parsed = ScriptSchema.parse(data);
    expect(parsed.images).toEqual([]);
  });

  it("accepts quote-card, timeline, and chart-bars templates and optional bgm", () => {
    const data = {
      version: "1.0",
      metadata: {
        title: "Test",
        source: { url: "https://test.com", domain: "test.com", image: null },
        channel: "Test",
      },
      bgm: "chill-tech",
      scenes: [
        {
          id: "h",
          type: "hook",
          voiceText: "Hook",
          templateData: { template: "hook", headline: "Headline" },
        },
        {
          id: "q",
          type: "body",
          voiceText: "Quote",
          templateData: {
            template: "quote-card",
            quote: "AI will transform everything.",
            author: "Sam Altman",
            title: "CEO OpenAI",
          },
        },
        {
          id: "t",
          type: "body",
          voiceText: "Timeline",
          templateData: {
            template: "timeline",
            title: "Lộ trình ra mắt",
            events: [
              { time: "Tháng 6", label: "Beta release" },
              { time: "Tháng 9", label: "Chính thức toàn cầu" },
            ],
          },
        },
        {
          id: "c",
          type: "body",
          voiceText: "Chart",
          templateData: {
            template: "chart-bars",
            title: "Hiệu năng so sánh",
            items: [
              { label: "M4 Pro", value: 92, displayValue: "92 FPS", color: "cyan" },
              { label: "M3 Pro", value: 70, displayValue: "70 FPS", color: "purple" },
            ],
          },
        },
        {
          id: "o",
          type: "outro",
          voiceText: "Outro",
          templateData: {
            template: "outro",
            ctaTop: "Follow",
            channelName: "Channel",
            source: "Source.vn",
          },
        },
      ],
    };

    const parsed = ScriptSchema.parse(data);
    expect(parsed.bgm).toBe("chill-tech");
    expect(parsed.scenes.length).toBe(5);
    expect(parsed.scenes[1].templateData.template).toBe("quote-card");
    expect(parsed.scenes[2].templateData.template).toBe("timeline");
    expect(parsed.scenes[3].templateData.template).toBe("chart-bars");
  });
});
