// ======= 配置拉取 =======
let keywordConfig = null;
async function loadKeywordConfig() {
  if (keywordConfig) return keywordConfig;
  const res = await fetch("https://你的worker子域名.workers.dev/config.json");
  if (!res.ok) throw new Error("❌ 无法加载配置文件");
  keywordConfig = await res.json();
  return keywordConfig;
}

// ======= 工具函数 =======
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

// ======= 缓存设置 =======
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

// ======= 状态控制 =======
let followCount = 0;
let isPaused = true;
let processingCount = 0;
const maxConcurrent = 3;
const followQueue = [];

// ======= 获取用户资料 API =======
async function getProfileData(handle) {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`❌ 获取资料失败: ${handle}`, err.message);
    return null;
  }
}

// ======= 卡片处理逻辑 =======
async function handleCard(card) {
  try {
    if (card.dataset.processed || isPaused || processingCount >= maxConcurrent) return;

    const {
      blockedNameKeywords,
      blockedGeneralKeywords,
      targetNameKeywords,
      targetGeneralKeywords
    } = await loadKeywordConfig();

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

    // 屏蔽规则
    if (
      matchSubstring(nickname, blockedNameKeywords) ||
      matchSubstring(username, blockedNameKeywords) ||
      (hasBio && matchWholeWord(bioText, blockedGeneralKeywords))
    ) {
      console.warn(`⛔️ Blocked: ${nickname} (${username})`);
      return;
    }

    // 命中关键词
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

    if (!matched) {
      console.log(`🟤 Skipped: ${nickname} (${username})`);
      return;
    }

    // 请求资料
    const fullHandle = username.includes(".") ? username : `${username}.bsky.social`;
    const profile = await getProfileData(fullHandle);
    if (!profile) return;

    const { followersCount = 0, followsCount = 0 } = profile;
    if (followersCount < 500 && followsCount < 500) {
      card._followBtn = card._followBtn || card.querySelector('button[aria-label="Follow"], button[aria-label="关注"]');
      if (card._followBtn) {
        followQueue.push({ btn: card._followBtn, card });
        console.log(`🔜 Enqueued follow: ${nickname} (${username})`);
      }
    } else {
      console.log(`⛔️ Skipped (粉丝过多): ${nickname} (${username})`);
    }
  } catch (err) {
    console.error("🚨 handleCard 错误", err);
  } finally {
    processingCount--;
  }
}

// ======= 自动点击关注队列 =======
async function dequeueFollow() {
  if (isPaused || followQueue.length === 0) {
    setTimeout(dequeueFollow, 500);
    return;
  }

  const { btn } = followQueue.shift();
  try {
    btn.click();
    followCount++;
    counterBox.innerText = `✅ Followed: ${followCount}`;
    console.log(`✅ Followed`);
  } catch (e) {
    console.warn("⚠️ Follow failed", e);
  } finally {
    dequeueFollow();
  }
}
dequeueFollow();

// ======= 主处理入口 =======
function processAllCards() {
  if (isPaused) return;
  const cards = Array.from(document.querySelectorAll('div[style*="padding"][style*="border-top-width"]'));
  for (const card of cards) {
    if (processingCount < maxConcurrent) {
      handleCard(card);
    }
  }
}

// ======= 页面变动监听 =======
const observer = new MutationObserver(() => {
  if (!isPaused) processAllCards();
});
observer.observe(document.body, { childList: true, subtree: true });

// ======= 自动滚动到底部（每秒）=======
setInterval(() => {
  if (!isPaused) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
}, 1000);

// ======= UI 状态框 =======
const counterBox = document.createElement("div");
Object.assign(counterBox.style, {
  position: "fixed", bottom: "20px", right: "20px",
  backgroundColor: "#222", color: "#0f0", padding: "10px 15px",
  borderRadius: "8px", fontSize: "14px", zIndex: "9999",
  boxShadow: "0 0 8px rgba(0,0,0,0.5)", display: "none"
});
counterBox.innerText = `✅ Followed: 0`;
document.body.appendChild(counterBox);

// ======= 快捷键控制（R 启动 / Q 暂停 / C 清除缓存）=======
alert("🟡 自动关注就绪：R 启动，Q 暂停，C 清缓存");
document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "q") {
    isPaused = true;
    counterBox.style.display = "none";
    console.log("⏸ 已暂停自动关注");
  } else if (key === "r") {
    isPaused = false;
    counterBox.style.display = "block";
    console.log("▶️ 已恢复自动关注");
    processAllCards();
  } else if (key === "c") {
    localStorage.removeItem(localCacheKey);
    userCache = [];
    processedUsers = new Set();
    alert("🧹 缓存已清除！");
    console.log("✅ 本地缓存清除成功");
  }
});
