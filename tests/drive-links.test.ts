import { describe, expect, it } from "vitest";
import { parseDriveUrl } from "../src/client/driveLinks";

describe("Google file links in emails", () => {
  it("recognises Docs, Sheets, Slides and Drive files, including Google's redirect links", () => {
    expect(parseDriveUrl("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit?usp=drive_web")).toMatchObject({
      kind: "document",
      previewUrl: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/preview",
    });
    expect(parseDriveUrl("https://www.google.com/url?q=https://docs.google.com/spreadsheets/u/1/d/1ZyXwVuTsRqPoNmLkJiHgFe9876/edit&sa=D")?.kind).toBe("spreadsheets");
    expect(parseDriveUrl("https://docs.google.com/presentation/d/1PqRsTuVwXyZaBcDeFgHiJk4567/edit")?.kind).toBe("presentation");
    expect(parseDriveUrl("https://drive.google.com/file/d/1FiLeIdFiLeIdFiLeIdFiLeId99/view?usp=drive_web")).toMatchObject({
      kind: "file",
      previewUrl: "https://drive.google.com/file/d/1FiLeIdFiLeIdFiLeIdFiLeId99/preview",
    });
    expect(parseDriveUrl("https://drive.google.com/open?id=1OpEnIdOpEnIdOpEnIdOpEnId77")?.kind).toBe("file");
  });

  it("ignores other links", () => {
    expect(parseDriveUrl("https://example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123")).toBeNull();
    expect(parseDriveUrl("https://docs.google.com/forms/d/e/1FAIpQLSc/viewform")).toBeNull();
    expect(parseDriveUrl("mailto:someone@example.com")).toBeNull();
  });
});
