const remoteConfigUrl = "https://raw.githubusercontent.com/damimi88/fensi/main/gjc.json";

let blockedNameKeywords = [];
let blockedGeneralKeywords = [];
let targetNameKeywords = [];
let targetGeneralKeywords = [];

let isPaused = false;
let isReady = false;

async function fetchRemoteConfig() {
  try {
    const res = await fetch(remoteConfigUrl);
    const cfg = await res.json();

    blockedNameKeywords = cfg.blockedNameKeywords || [];
    blockedGeneralKeywords = cfg.blockedGeneralKeywords || [];
    targetNameKeywords = cfg.targetNameKeywords || [];
    targetGeneralKeywords = cfg.targetGeneralKeywords || [];

    isPaused = !!cfg.paused;
  } catch {}
}

(async () => {
  await fetchRemoteConfig();
  isReady = true;
})();

function matchWholeWord(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some(w => new RegExp(`\\b${w}\\b`, "i").test(lower));
}
function matchSubstring(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some(w => lower.includes(w.toLowerCase()));
}
function extractUsername(text) {
  const match = text.match(/@([\w\-\.]+)\.bsky\.social/);
  return match ? match[1].toLowerCase() : "";
}
function normalize(text) {
  return text.toLowerCase().trim();
}

// 本地缓存与 processedUsers 相关功能已移除

let followCount = 0;
let processingCount = 0;
const maxConcurrent = 3;

async function getProfileData(handle) {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function handleCard(card) {
  try {
    if (!isReady || card.dataset.processed || isPaused || processingCount >= maxConcurrent) return;

    const cardText = card.innerText;
    if (!cardText || cardText.length < 10) return;

    const nickMatch = cardText.match(/^(.*?)\n@/);
    const nickname = nickMatch ? normalize(nickMatch[1]) : "";
    const username = extractUsername(cardText);
    const bioText = cardText.replace(nickMatch?.[0] || "", "").replace(/@\w+\.bsky\.social/, "").trim();
    const hasBio = bioText.length > 0;

    if (!username) return;

    // 标记为已处理，防止同一卡片再处理
    card.dataset.processed = "true";
    processingCount++;

    if (
      matchSubstring(nickname, blockedNameKeywords) ||
      matchSubstring(username, blockedNameKeywords) ||
      (hasBio && matchWholeWord(bioText, blockedGeneralKeywords))
    ) {
      return;
    }

    let matched = false;
    if (hasBio) {
      matched =
        matchSubstring(nickname, targetNameKeywords) ||
        matchSubstring(username, targetNameKeywords) ||
        matchSubstring(bioText, targetGeneralKeywords);
    } else {
      matched =
        matchSubstring(nickname, targetNameKeywords) ||
        matchSubstring(username, targetNameKeywords) ||
        matchSubstring(nickname, targetGeneralKeywords) ||
        matchSubstring(username, targetGeneralKeywords);
    }

    if (!matched) return;

    const fullHandle = username.includes(".") ? username : `${username}.bsky.social`;
    const profile = await getProfileData(fullHandle);
    if (!profile) return;

    const { followersCount = 0, followsCount = 0 } = profile;
    if (followersCount < 500 && followsCount < 500) {
      card._followBtn = card._followBtn || card.querySelector('button[aria-label="Follow"], button[aria-label="关注"]');
      if (card._followBtn) {
        // 立即点击，不再排队与延迟
        try {
          card._followBtn.click();
          followCount++;
          counterBox.innerText = `✅ Followed: ${followCount}`;
        } catch {}
      }
    }
  } catch {}
  finally {
    processingCount--;
  }
}

function processAllCards() {
  if (isPaused || !isReady) return;
  const cards = Array.from(document.querySelectorAll('div[style*="padding"][style*="border-top-width"]'));
  for (const card of cards) {
    if (processingCount < maxConcurrent) {
      handleCard(card);
    }
  }
}

const observer = new MutationObserver(() => {
  if (!isPaused) processAllCards();
});
observer.observe(document.body, { childList: true, subtree: true });

(function keepScrollBottom() {
  function scrollToBottom() {
    if (!isPaused) {
      window.scrollTo(0, document.body.scrollHeight);
    }
    requestAnimationFrame(scrollToBottom);
  }
  scrollToBottom();
})();

const counterBox = document.createElement("div");
Object.assign(counterBox.style, {
  position: "fixed", bottom: "20px", right: "20px",
  backgroundColor: "#222", color: "#0f0", padding: "10px 15px",
  borderRadius: "8px", fontSize: "14px", zIndex: "9999",
  boxShadow: "0 0 8px rgba(0,0,0,0.5)", display: "none"
});
counterBox.innerText = `✅ Followed: 0`;
document.body.appendChild(counterBox);

document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "q") {
    isPaused = true;
    counterBox.style.display = "none";
  } else if (key === "r") {
    isPaused = false;
    counterBox.style.display = "block";
    processAllCards();
  }
  // 清除本地缓存功能已移除（不再存储用户），所以不再实现 'c' 键行为
});

counterBox.style.display = "block";
processAllCards();
