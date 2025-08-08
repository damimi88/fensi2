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

const localCacheKey = "bsky_user_cache_v1";
const maxCacheSize = 10000;
let userCache = JSON.parse(localStorage.getItem(localCacheKey) || "[]");
let processedUsers = new Set(userCache);

function saveToCache(username) {
  if (!processedUsers.has(username)) {
    userCache.push(username);
    if (userCache.length > maxCacheSize) {
      userCache = userCache.slice(userCache.length - maxCacheSize);
    }
    processedUsers = new Set(userCache);
    localStorage.setItem(localCacheKey, JSON.stringify(userCache));
  }
}

let followCount = 0;
let processingCount = 0;
const maxConcurrent = 3;
const followQueue = [];

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

    if (!username || processedUsers.has(username)) return;
    card.dataset.processed = "true";
    saveToCache(username);
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
    if (followersCount < 1000 && followsCount < 1000) {
      card._followBtn = card._followBtn || card.querySelector('button[aria-label="Follow"], button[aria-label="关注"]');
      if (card._followBtn) {
        followQueue.push({ btn: card._followBtn, card });
      }
    }
  } catch {}
  finally {
    processingCount--;
  }
}

async function dequeueFollow() {
  if (isPaused || followQueue.length === 0) {
    setTimeout(dequeueFollow, 200);
    return;
  }

  const { btn } = followQueue.shift();
  try {
    btn.click();
    followCount++;
    counterBox.innerText = `✅ Followed: ${followCount}`;
  } catch {}
  finally {
    const delay = 300 + Math.random() * 100;
    setTimeout(dequeueFollow, delay);
  }
}
dequeueFollow();

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
  } else if (key === "c") {
    localStorage.removeItem(localCacheKey);
    userCache = [];
    processedUsers = new Set();
  }
});

counterBox.style.display = "block";
processAllCards();
