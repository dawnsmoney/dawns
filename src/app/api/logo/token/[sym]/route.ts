import { tokenLogo, serveLogo, glyphOf } from "@/lib/logos";
import { symbolKey } from "@/components/bits";

export async function GET(_: Request, { params }: { params: Promise<{ sym: string }> }) {
  const k = symbolKey(decodeURIComponent((await params).sym).slice(0, 24));
  return serveLogo(await tokenLogo(k), k, glyphOf(k));
}
