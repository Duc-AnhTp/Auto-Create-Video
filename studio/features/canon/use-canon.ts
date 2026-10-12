import type React from 'react';
import type { request } from '../../shared/api/client.js';
import { useScopedState } from '../../shared/api/use-scoped-state.js';
import type { AutoRepairResult, PrunedSemanticContextData, SemanticMemoryEntityItem, ValidationReport } from '../../../src/contracts/studio-features.js';
export function useCanon({ seriesId, text, prefix, api, active, setText, setNotice, setError }: {
    seriesId: string;
    text: string;
    prefix: string;
    api: typeof request;
    active: () => boolean;
    setText: React.Dispatch<React.SetStateAction<string>>;
    setNotice: (text: string) => void;
    setError: (text: string) => void;
}) {
    const [canonReport, setCanonReport] = useScopedState<ValidationReport | null>(null, active);
    const [isValidatingCanon, setIsValidatingCanon] = useScopedState(false, active);
    const [isRepairingCanon, setIsRepairingCanon] = useScopedState(false, active);
    const handleValidateCanon = async () => {
        if (!seriesId || !text.trim())
            return;
        setIsValidatingCanon(true);
        try {
            const res = await api<{
                report: ValidationReport;
            }>(`${prefix}/canon/validate`, { scriptText: text });
            setCanonReport(res.report);
            if (res.report.status === "PASS") {
                setNotice("✓ Kịch bản tuân thủ 100% nhân quả của Story Bible.");
            }
            else if (res.report.status === "WARN") {
                setNotice(`⚠ Phát hiện ${res.report.repairableCount} vi phạm có thể tự động sửa bằng Phân Cảnh Bắc Cầu.`);
            }
            else {
                setError(`✕ Phát hiện ${res.report.fatalCount} vi phạm nghiêm trọng (Anti-Resurrection / Lộ tri thức).`);
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setIsValidatingCanon(false);
        }
    };
    const handleAutoRepairCanon = async () => {
        if (!seriesId || !text.trim())
            return;
        setIsRepairingCanon(true);
        try {
            const res = await api<{
                result: AutoRepairResult;
            }>(`${prefix}/canon/repair`, { scriptText: text, persistToBible: true });
            if (res.result) {
                setText(res.result.repairedScript);
                setCanonReport(res.result.validationReport);
                setNotice(`Đã tự động chèn ${res.result.appliedBridges.length} Phân Cảnh Bắc Cầu (Bridge Scenes) và cập nhật Story Bible thành PASS!`);
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setIsRepairingCanon(false);
        }
    };
    const handleQuerySemanticMemory = async (queryText: string, tokenBudget?: number) => {
        const res = await api<{
            prunedContext: PrunedSemanticContextData;
            queryResults: SemanticMemoryEntityItem[];
        }>(`${prefix}/semantic-memory/query`, {
            queryText,
            tokenBudget: tokenBudget || 3000,
        });
        return {
            prunedContext: res.prunedContext,
            queryResults: res.queryResults,
        };
    };
    return { canonReport, setCanonReport, isValidatingCanon, isRepairingCanon, handleValidateCanon, handleAutoRepairCanon, handleQuerySemanticMemory };
}
