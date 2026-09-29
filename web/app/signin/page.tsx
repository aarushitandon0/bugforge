import type { Metadata } from "next";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { Auth } from "@/components/screens/Auth";

export const metadata: Metadata = { title: "account" };

export default function Page() {
  return (
    <Shell>
      <Suspense>
        <Auth />
      </Suspense>
    </Shell>
  );
}
