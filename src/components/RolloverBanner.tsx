import { useState, useEffect } from "react";
import { X, Info } from "lucide-react";
import { adminApi } from "@/lib/api";

const LAST_SEEN_KEY = "rolloverBannerLastSeenYear";

export default function RolloverBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [activeYear, setActiveYear] = useState("");

  useEffect(() => {
    adminApi.getSettings().then((res) => {
      const settings = res.data?.settings;
      if (!settings?.currentSchoolYear) return;
      const sy = settings.currentSchoolYear;
      const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      if (sy && sy !== lastSeen) {
        setMessage(`School Year ${sy} is now active.`);
        setActiveYear(sy);
        setVisible(true);
      }
    }).catch(() => {});
  }, []);

  if (!visible) return null;

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-blue-800">
        <Info className="w-4 h-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
      <button
        onClick={() => {
          setVisible(false);
          if (activeYear) {
            localStorage.setItem(LAST_SEEN_KEY, activeYear);
          }
        }}
        className="text-blue-600 hover:text-blue-800 p-0.5"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
