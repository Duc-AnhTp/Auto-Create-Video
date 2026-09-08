import { describe, it, expect } from "vitest";
import {
  integerToVietnamese,
  normalizeVietnameseForTts,
  TECH_LEXICON,
} from "./vietnamese-normalizer.js";

describe("integerToVietnamese", () => {
  it("converts single digits", () => {
    expect(integerToVietnamese(0)).toBe("không");
    expect(integerToVietnamese(5)).toBe("năm");
    expect(integerToVietnamese(9)).toBe("chín");
  });

  it("converts numbers between 10 and 99", () => {
    expect(integerToVietnamese(10)).toBe("mười");
    expect(integerToVietnamese(14)).toBe("mười bốn");
    expect(integerToVietnamese(15)).toBe("mười lăm");
    expect(integerToVietnamese(21)).toBe("hai mươi mốt");
    expect(integerToVietnamese(24)).toBe("hai mươi tư");
    expect(integerToVietnamese(35)).toBe("ba mươi lăm");
    expect(integerToVietnamese(80)).toBe("tám mươi");
  });

  it("converts hundreds, thousands, millions and billions", () => {
    expect(integerToVietnamese(100)).toBe("một trăm");
    expect(integerToVietnamese(105)).toBe("một trăm lẻ năm");
    expect(integerToVietnamese(250)).toBe("hai trăm năm mươi");
    expect(integerToVietnamese(5000)).toBe("năm nghìn");
    expect(integerToVietnamese(1000005)).toBe("một triệu không trăm nghìn không trăm lẻ năm");
    expect(integerToVietnamese(1500000)).toBe("một triệu năm trăm nghìn");
    expect(integerToVietnamese(2000000000)).toBe("hai tỷ");
    expect(integerToVietnamese(2000000500)).toBe("hai tỷ không trăm triệu không trăm nghìn năm trăm");
    expect(integerToVietnamese(2000500000)).toBe("hai tỷ không trăm triệu năm trăm nghìn");
    expect(integerToVietnamese(2050000000)).toBe("hai tỷ không trăm năm mươi triệu");
  });
});

describe("normalizeVietnameseForTts", () => {
  it("normalizes version decimals correctly without saying 'rưỡi'", () => {
    const input = "Mô hình GPT 5.5 và iOS 18.2 đã chính thức ra mắt.";
    const output = normalizeVietnameseForTts(input);
    expect(output).toContain("năm chấm năm");
    expect(output).toContain("mười tám chấm hai");
    expect(output).not.toContain("rưỡi");
  });

  it("normalizes percentages and handles thousand dots in percentages", () => {
    const input = "Hiệu năng tăng 82.7% so với mức 50% trước đây.";
    const output = normalizeVietnameseForTts(input);
    expect(output).toContain("tám mươi hai phẩy bảy phần trăm");
    expect(output).toContain("năm mươi phần trăm");

    const inputThousandPct = "Tỷ lệ tăng trưởng đạt 1.500% so với cùng kỳ.";
    const outputThousandPct = normalizeVietnameseForTts(inputThousandPct);
    expect(outputThousandPct).toContain("một nghìn năm trăm phần trăm");
  });

  it("normalizes technical specifications (battery, storage, camera, frequency) and thousand dots", () => {
    const input = "Máy sở hữu pin 5000mAh, camera 200MP, xung nhịp 3.2GHz và bộ nhớ 128GB.";
    const output = normalizeVietnameseForTts(input);
    expect(output).toContain("năm nghìn mi li am pe giờ");
    expect(output).toContain("hai trăm mê ga píc xen");
    expect(output).toContain("ba phẩy hai ghi ga héc");
    expect(output).toContain("một trăm hai mươi tám ghi ga bai");

    // Thousand-separated specs like 10.000mAh
    const inputThousandSpec = "Trang bị viên pin khủng 10.000mAh.";
    const outputThousandSpec = normalizeVietnameseForTts(inputThousandSpec);
    expect(outputThousandSpec).toContain("mười nghìn mi li am pe giờ");

    // Decimal tech specs
    const decInput = "Bộ nhớ 1.5GB RAM, camera 48.5MP và chip 1.8nm.";
    const decOutput = normalizeVietnameseForTts(decInput);
    expect(decOutput).toContain("một phẩy năm ghi ga bai");
    expect(decOutput).toContain("bốn mươi tám phẩy năm mê ga píc xen");
    expect(decOutput).toContain("một phẩy tám na nô mét");
  });

  it("normalizes multipliers (2x, 5x, gấp 2x) without duplicating 'gấp' and does NOT corrupt screen resolutions or dimensions", () => {
    const input1 = "Tốc độ xử lý nhanh hơn 2x.";
    expect(normalizeVietnameseForTts(input1)).toContain("gấp hai lần");

    const input2 = "Hiệu năng xử lý nhanh gấp 2x so với trước.";
    const output2 = normalizeVietnameseForTts(input2);
    expect(output2).toContain("nhanh gấp hai lần");
    expect(output2).not.toContain("gấp gấp");

    // Screen resolutions and dimensions (1920x1080, 1920 x 1080, 100 x 200 mm, 3x4) must remain intact
    const inputRes = "Màn hình độ phân giải 1920x1080, kích thước 100 x 200 mm và tỷ lệ 3x4.";
    const outputRes = normalizeVietnameseForTts(inputRes);
    expect(outputRes).toContain("1920x1080");
    expect(outputRes).toContain("100 x 200 mm");
    expect(outputRes).toContain("3x4");
    expect(outputRes).not.toContain("gấp một nghìn");
    expect(outputRes).not.toContain("gấp một trăm");
    expect(outputRes).not.toContain("gấp ba");

    const inputSpacedRes = "Độ phân giải 1920 x 1080 sắc nét.";
    const outputSpacedRes = normalizeVietnameseForTts(inputSpacedRes);
    expect(outputSpacedRes).toContain("1920 x 1080");
    expect(outputSpacedRes).not.toContain("gấp");

    // IP addresses must not be mangled by thousand separators
    const inputIp = "Địa chỉ máy chủ cục bộ là 192.168.1.1 và DNS 8.8.8.8.";
    const outputIp = normalizeVietnameseForTts(inputIp);
    expect(outputIp).toContain("192.168.1.1");
    expect(outputIp).not.toContain("một trăm chín mươi hai nghìn");

    const inputVietX = "iPhone 16 xách tay từ 10 xưởng sản xuất.";
    const outputVietX = normalizeVietnameseForTts(inputVietX);
    expect(outputVietX).not.toContain("gấp");
    expect(outputVietX).toContain("xách tay");
    expect(outputVietX).toContain("xưởng");
  });

  it("normalizes currency ($500, $9.99, $5.5, $5 tỷ, $10 triệu, $10.000, $10,000, $5K, 10,000 USD)", () => {
    const input1 = "Giá khởi điểm từ $500.";
    expect(normalizeVietnameseForTts(input1)).toContain("năm trăm đô la");

    const inputDec = "Gói thuê bao $9.99 và $5.5 một tháng.";
    const outputDec = normalizeVietnameseForTts(inputDec);
    expect(outputDec).toContain("chín phẩy chín chín đô la");
    expect(outputDec).toContain("năm phẩy năm đô la");
    expect(outputDec).toContain("một tháng");
    expect(outputDec).not.toContain("triệu đô laột");

    const input2 = "Khoản đầu tư trị giá $5 tỷ vào AI.";
    expect(normalizeVietnameseForTts(input2)).toContain("năm tỷ đô la");

    const input3 = "Doanh thu đạt $10 triệu USD năm nay.";
    expect(normalizeVietnameseForTts(input3)).toContain("mười triệu đô la");

    const inputThousandDot = "Giá chiếc máy là $10.000.";
    expect(normalizeVietnameseForTts(inputThousandDot)).toContain("mười nghìn đô la");
    expect(normalizeVietnameseForTts(inputThousandDot)).not.toContain("$");

    const inputThousandComma = "Giá bán là $10,000 tại Mỹ.";
    expect(normalizeVietnameseForTts(inputThousandComma)).toContain("mười nghìn đô la");

    const inputK = "Chi phí khoảng $5K cho bản Pro và $10k cho bản Max.";
    const outputK = normalizeVietnameseForTts(inputK);
    expect(outputK).toContain("năm nghìn đô la");
    expect(outputK).toContain("mười nghìn đô la");

    const inputNghin = "Chi phí khoảng $500 nghìn đô la.";
    const outputNghin = normalizeVietnameseForTts(inputNghin);
    expect(outputNghin).toContain("năm trăm nghìn đô la");
    expect(outputNghin).not.toContain("đô la nghìn");

    const inputUsdComma = "Mức giá 10,000 USD rất hợp lý.";
    expect(normalizeVietnameseForTts(inputUsdComma)).toContain("mười nghìn đô la");

    const inputUsdDot = "Khoảng 1.500.000 USD cho dự án.";
    expect(normalizeVietnameseForTts(inputUsdDot)).toContain("một triệu năm trăm nghìn đô la");
  });

  it("pronounces zero-thousands properly in Vietnamese numbers", () => {
    expect(integerToVietnamese(1000500)).toContain("không trăm nghìn");
    expect(integerToVietnamese(1005000)).toBe("một triệu không trăm lẻ năm nghìn");
  });

  it("normalizes dot-separated Vietnamese numbers correctly", () => {
    const input1 = "Giá bán là 1.500.000 đồng.";
    expect(normalizeVietnameseForTts(input1)).toContain("một triệu năm trăm nghìn");

    const input2 = "Hơn 2.200.000 người dùng tham gia.";
    expect(normalizeVietnameseForTts(input2)).toContain("hai triệu hai trăm nghìn");

    const input3 = "Số lượng 10.000 máy.";
    expect(normalizeVietnameseForTts(input3)).toContain("mười nghìn");
  });

  it("replaces tech acronyms and brands with phonetics", () => {
    const input = "OpenAI vừa cập nhật API mới cho Claude và DeepSeek hỗ trợ GPU.";
    const output = normalizeVietnameseForTts(input);
    expect(output).toContain("Open ây ai");
    expect(output).toContain("ây pi ai");
    expect(output).toContain("Clo đờ");
    expect(output).toContain("Đíp xích");
    expect(output).toContain("gờ pơ u");
  });

  it("normalizes symbols and unicode hashtags correctly", () => {
    const input = "Phần mềm & phần cứng + thuật toán #AI cùng bước tiến #độtphá và #côngnghệ";
    const output = normalizeVietnameseForTts(input);
    expect(output).toContain("và");
    expect(output).toContain("cộng");
    expect(output).toContain("ây ai");
    expect(output).toContain("độtphá");
    expect(output).toContain("côngnghệ");
    expect(output).not.toContain("#");
  });

  it("is idempotent: re-normalizing already normalized text does not break it", () => {
    const input = "GPT 5.5 có giá $100.";
    const once = normalizeVietnameseForTts(input);
    const twice = normalizeVietnameseForTts(once);
    expect(twice).toBe(once);
  });
});
