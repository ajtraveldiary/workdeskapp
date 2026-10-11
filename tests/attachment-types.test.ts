// Attachments a sender labelled as generic data are still shown when their file name says what they are
// (user request 2026-10-11: pictures sent as "file").
import { describe, expect, it } from "vitest";
import { realMime } from "../src/server/routes/threads";

describe("attachment types", () => {
  it("uses the file's ending when the sender labelled it as a generic file", () => {
    expect(realMime("application/octet-stream", "Photo.JPG")).toBe("image/jpeg");
    expect(realMime("", "scan.jpeg")).toBe("image/jpeg");
    expect(realMime("binary/octet-stream", "chart.png")).toBe("image/png");
    expect(realMime("application/octet-stream", "order.pdf")).toBe("application/pdf");
  });
  it("keeps a proper type, and doesn't guess for other endings", () => {
    expect(realMime("image/webp", "x.jpg")).toBe("image/webp");
    expect(realMime("application/octet-stream", "minutes.docx")).toBe("application/octet-stream");
    expect(realMime("application/octet-stream", "noextension")).toBe("application/octet-stream");
  });
});
