import { describe, expect, it } from "vitest";
import { toCsv } from "../shared/csv.ts";

describe("toCsv", () => {
  it("quotes only the cells that need it and leaves empty cells blank", () => {
    const text = toCsv([
      ["Fecha", "Peso", "Nota"],
      ["2026-11-06", 96.2, 'Cena "tarde", salada'],
      ["2026-11-05", 96.4, null],
    ]);
    expect(text).toBe('﻿Fecha,Peso,Nota\r\n2026-11-06,96.2,"Cena ""tarde"", salada"\r\n2026-11-05,96.4,\r\n');
  });

  it("keeps line breaks inside a quoted cell", () => {
    expect(toCsv([["a\nb"]])).toBe('﻿"a\nb"\r\n');
  });
});
