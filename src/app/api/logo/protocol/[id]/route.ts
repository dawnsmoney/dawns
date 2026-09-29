import { protocolLogo, serveLogo } from "@/lib/logos";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id).replace(/[^a-z0-9-]/gi, "").slice(0, 60);
  const letter = (new URL(req.url).searchParams.get("l") ?? id.slice(0, 1).toUpperCase()).slice(0, 2);
  return serveLogo(protocolLogo(id), id, letter);
}
