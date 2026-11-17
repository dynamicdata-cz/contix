import { z } from "zod";

/* ============================================================
 * Vzhled výstupů (v1.59, ADR-154): logo, barva a text zápatí společnosti ve všech tiskových
 * výstupech (PDF / tisk) a ve Wordu. Dceřiná společnost bez vlastního nastavení dědí od nadřazené.
 * ============================================================ */

export const BRAND_LOGO_MAX_BYTES = 400 * 1024;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const BrandingInput = z.object({
  /** data:image/png|jpeg;base64,… ; null = odebrat, vynecháno = ponechat. */
  logo: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "Logo musí být obrázek PNG nebo JPEG")
    .max(Math.ceil((BRAND_LOGO_MAX_BYTES * 4) / 3) + 40, "Logo je větší než 400 kB")
    .nullable()
    .optional(),
  /** Barva nadpisů a čar (#RRGGBB); null = výchozí. */
  accentColor: z.string().regex(HEX, "Barva ve tvaru #RRGGBB").nullable().default(null),
  /** Text v zápatí každé stránky (např. „Interní – nešířit“). */
  footerText: z.string().trim().max(200).default(""),
  /** Zobrazit v záhlaví i název společnosti vedle loga. */
  showName: z.boolean().default(true),
});
export type BrandingInput = z.input<typeof BrandingInput>;

export interface BrandingDto {
  companyId: string;
  /** Vlastní nastavení této společnosti (false = dědí, nebo nic). */
  own: boolean;
  /** Od které společnosti se nastavení použije (vlastní nebo nadřazená). */
  sourceCompanyId: string | null;
  sourceCompanyName: string | null;
  logo: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  accentColor: string | null;
  footerText: string;
  showName: boolean;
}
