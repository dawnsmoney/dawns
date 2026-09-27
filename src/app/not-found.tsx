import Link from "next/link";
import { Banner } from "@/components/Banner";

export default function NotFound() {
  return (
    <Banner title="Nothing here yet" lede="This page doesn't exist. The protocols list has everything dawns tracks today.">
      <div className="ctas"><Link className="btn sun" href="/protocols">See protocols</Link></div>
    </Banner>
  );
}
