import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { depthRelightingEngine_vectorFromAngles, depthRelightingEngine_synthesizeRelightingFilterGraph, depthRelightingEngine_generateComfyUiPromptDirectives, depthRelightingEngine_computeShadingMultiplier, sceneLightingMatcher_resolveEnvironmentPreset } from "../../../modules/media/index.js";
import { readScopedJson } from "../scoped-request.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route43_relightSim(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const relightSimMatch = url.pathname.match(/^\/api\/(?:v1\/)?media\/lighting\/simulate-relight$/);
    if (!(relightSimMatch && req.method === "POST"))
        return false;
    const body = z
        .object({
        azimuthDeg: z.number().default(45),
        elevationDeg: z.number().default(25),
        intensity: z.number().default(1.2),
        cctKelvin: z.number().default(4800),
        enableRimLight: z.boolean().default(true),
        depthScale: z.number().default(3.5),
        preset: z.enum(["golden_hour", "daylight_overcast", "cyberpunk_night", "interior_candle"]).optional(),
    })
        .parse(await readScopedJson(req, url));
    const env = sceneLightingMatcher_resolveEnvironmentPreset((body.preset || "golden_hour") as any, body.azimuthDeg, body.elevationDeg);
    const vector3D = depthRelightingEngine_vectorFromAngles(body.azimuthDeg, body.elevationDeg);
    const relightingConfig = {
        keyLight: {
            ...env.keyLight,
            azimuthDeg: body.azimuthDeg,
            elevationDeg: body.elevationDeg,
            intensity: body.intensity,
            cctKelvin: body.cctKelvin,
            vector3D,
        },
        ambient: env.ambient,
        depthScale: body.depthScale,
        foregroundWeight: 0.8,
        enableRimLight: body.enableRimLight,
        enableAmbientBounce: true,
    };
    const filterGraph = depthRelightingEngine_synthesizeRelightingFilterGraph(relightingConfig);
    const comfyUiDirectives = depthRelightingEngine_generateComfyUiPromptDirectives(relightingConfig);
    const normalSample: [
        number,
        number,
        number
    ] = [0, 0, 1];
    const sampleShading = depthRelightingEngine_computeShadingMultiplier(normalSample, relightingConfig);
    send({
        success: true,
        relightingConfig,
        filterGraph,
        comfyUiDirectives,
        sampleShading,
    });
    return true;
}
