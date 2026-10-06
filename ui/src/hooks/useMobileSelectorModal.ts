import { useEffect, useState } from "react";

const MOBILE_SELECTOR_QUERY = "(max-width: 40rem)";

/** Whether picker sheets render as mobile bottom sheets and need their own modal scroll lock. */
export function useMobileSelectorModal() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia(MOBILE_SELECTOR_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_SELECTOR_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mobile;
}
