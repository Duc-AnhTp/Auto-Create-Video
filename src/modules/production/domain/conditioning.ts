import type { ShotExecutionSpec, CharacterTurnaroundAngle } from "../../../contracts/video.js";

export function resolveCharacterConditioningImage(spec: ShotExecutionSpec): string | undefined {
  if (spec.characterTurnaround) {
    const angle = spec.characterTurnaround.viewAngle;
    if (angle === "profile" && spec.characterTurnaround.profile) return spec.characterTurnaround.profile;
    if (angle === "three_quarter" && spec.characterTurnaround.threeQuarter) return spec.characterTurnaround.threeQuarter;
    if (angle === "full_body" && spec.characterTurnaround.fullBody) return spec.characterTurnaround.fullBody;
    if (angle === "front" && spec.characterTurnaround.front) return spec.characterTurnaround.front;
    // Fallbacks within turnaround pack
    const turnaroundFallback =
      spec.characterTurnaround.threeQuarter ||
      spec.characterTurnaround.front ||
      spec.characterTurnaround.profile ||
      spec.characterTurnaround.fullBody;
    if (turnaroundFallback) return turnaroundFallback;
  }
  return spec.characterReferenceImage || spec.referenceImage || spec.firstFrameCondition;
}

export function mapShotToTurnaroundViewAngle(
  shotType?: string,
  cameraAngle?: string,
  prompt?: string
): CharacterTurnaroundAngle {
  const p = (prompt || "").toLowerCase();
  const st = (shotType || "").toLowerCase();
  const ca = (cameraAngle || "").toLowerCase();

  if (
    ca.includes("profile") ||
    ca.includes("side") ||
    st.includes("profile") ||
    p.includes("profile") ||
    p.includes("góc nghiêng") ||
    p.includes("nhìn nghiêng")
  ) {
    return "profile";
  }
  if (
    ca.includes("three_quarter") ||
    ca.includes("three-quarter") ||
    ca.includes("3/4") ||
    st.includes("three_quarter") ||
    st.includes("three-quarter") ||
    p.includes("three_quarter") ||
    p.includes("three-quarter") ||
    p.includes("ba phần tư") ||
    p.includes("3/4")
  ) {
    return "three_quarter";
  }
  if (
    st.includes("wide") ||
    st.includes("establishing") ||
    st.includes("full") ||
    ca.includes("wide") ||
    p.includes("toàn thân") ||
    p.includes("full body") ||
    p.includes("toàn cảnh")
  ) {
    return "full_body";
  }
  if (
    st === "close_up" ||
    st === "extreme_close_up" ||
    st.includes("close_up") ||
    ca.includes("front") ||
    p.includes("cận cảnh") ||
    p.includes("trực diện") ||
    p.includes("nhìn thẳng")
  ) {
    return "front";
  }
  // Default cinematic three-quarter angle for dialogue, medium, over-the-shoulder
  return "three_quarter";
}
