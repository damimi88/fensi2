// ==UserScript==
// @name         Twitter/X 用户卡片自动显示粉丝数&关注数&简介 (批量自动版 - 2025兼容)
// @namespace    http://tampermonkey.net/
// @version      2.32.15
// @description  在 Twitter/X 的各种页面上（包括评论区和关注列表），自动加载并在所有可见用户卡片内显示粉丝数、关注数、个人简介（GraphQL批量查询 - 自动提取哈希，兼容2025年10月，数据插入评论文本下方新行或列表 bio 下方，修复插入点未找到问题，优化API请求并行处理与限流，支持视图可见性动态显示/隐藏）
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // 用户数据缓存 (localStorage, 24小时过期)
  const CACHE_KEY = 'x_user_stats_cache';
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24小时

  function getCache(screenName) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const entry = cache[screenName];
      if (entry && Date.now() - entry.timestamp < CACHE_EXPIRY) {
        return entry.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function setCache(screenName, data) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      cache[screenName] = { data, timestamp: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.log('缓存失败:', e);
    }
  }

  // 认证信息缓存
  let cachedAuth = null;
  let lastAuthCheck = 0;
  const AUTH_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

  // 从API获取认证信息 - 简化版本
  function getTwitterAuth() {
    try {
      const now = Date.now();
      if (cachedAuth && now - lastAuthCheck < AUTH_CACHE_DURATION) {
        return cachedAuth;
      }

      const allCookies = document.cookie;
      const cookieObj = {};

      if (allCookies) {
        const cookies = allCookies.split(";");
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex > 0) {
            const name = trimmed.substring(0, eqIndex);
            const value = trimmed.substring(eqIndex + 1);
            if (
              name === "ct0" ||
              name === "auth_token" ||
              name === "csrf_token" ||
              name === "twid" ||
              name === "_twitter_sess" ||
              name.includes("twitter") ||
              name.includes("csrf") ||
              name.includes("auth")
            ) {
              cookieObj[name] = value;
            }
          }
        }
      }

      let csrfToken = cookieObj.ct0;
      if (!csrfToken) {
        const metaCsrf = document.querySelector('meta[name="csrf-token"]');
        if (metaCsrf?.content) csrfToken = metaCsrf.content;
        const otherCsrf =
          document.querySelector('input[name="authenticity_token"]') ||
          document.querySelector('meta[name="_token"]') ||
          document.querySelector("[data-csrf-token]");
        if (
          otherCsrf &&
          (otherCsrf.value || otherCsrf.content || otherCsrf.dataset.csrfToken)
        ) {
          csrfToken =
            otherCsrf.value || otherCsrf.content || otherCsrf.dataset.csrfToken;
        }
      }

      try {
        const localData =
          localStorage.getItem("twitter-auth") ||
          sessionStorage.getItem("twitter-auth");
        if (localData) {
          const parsed = JSON.parse(localData);
          if (parsed.csrfToken && !csrfToken) csrfToken = parsed.csrfToken;
        }
      } catch (e) {}

      const cookieString = Object.entries(cookieObj)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");

      const bearerToken =
        "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

      const authResult = {
        bearerToken,
        csrfToken: csrfToken || "",
        authToken: cookieObj.auth_token || "",
        twitterSession: cookieObj._twitter_sess || "",
        twid: cookieObj.twid || "",
        cookieString,
        allCookies: cookieObj,
        isComplete: !!(bearerToken && csrfToken && (cookieObj.auth_token || cookieObj._twitter_sess)),
      };

      if (!cachedAuth || cachedAuth.isComplete !== authResult.isComplete) {
        if (authResult.isComplete) console.log("✅ 认证信息完整");
        else console.log("⚠️ 认证信息不完整，但会尝试继续");
      }

      cachedAuth = authResult;
      lastAuthCheck = now;
      return authResult;
    } catch (error) {
      console.log("❌ 获取认证信息失败:", error.message);
      console.error(error);
      return null;
    }
  }

  // 定义黑名单
  const femaleNamesBlacklist = new Set([
    "ada", "addison", "adele", "adeline", "adriana", "adrienne", "agatha", "agnes", "aileen", "aisha",
    "alaina", "alana", "alayna", "alex", "alexandra", "alexandria", "alexis", "alice", "alicia", "alina",
    "alison", "alivia", "allison", "alondra", "alix", "alyvia", "amanda", "amber", "amelia", "amara",
    "amina", "amy", "ana", "anabelle", "anastasia", "andrea", "angel", "angela", "angelica", "angelina",
    "angelique", "angeline", "anika", "anita", "ann", "annabelle", "anne", "annette", "annie", "annika",
    "antoinette", "antonia", "anya", "april", "ariana", "arianna", "ariel", "arilyn", "aspen", "athena",
    "aubree", "aubrey", "audrey", "aurora", "autumn", "ayana", "ayla", "ayesha", "bailey", "barbara",
    "beatrice", "belinda", "bella", "bernice", "beth", "bethany", "beverly", "bianca", "blaire", "blake",
    "bonnie", "brandi", "briana", "brianna", "brielle", "britney", "brittany", "brittney", "brook", "brooke",
    "brooklyn", "brynn", "cadence", "caitlin", "caitlyn", "callie", "camila", "camille", "candace", "candice",
    "cara", "carla", "carly", "carmen", "carol", "carolyn", "carrie", "casey", "cassandra", "cassidy",
    "cassie", "catalina", "catherine", "cathy", "cecelia", "celeste", "celia", "celly", "charlene", "charlotte",
    "charmaine", "chaya", "chelsea", "cheri", "cheyenne", "chloe", "christa", "christian", "christie",
    "christina", "christine", "christy", "ciara", "cindy", "clair", "claire", "clara", "clarissa", "claudia",
    "colleen", "connie", "constance", "cora", "corinne", "courtney", "cristina", "crystal", "dahlia", "daisy",
    "dakota", "daleyza", "dana", "danica", "danielle", "daphne", "darcy", "darlene", "dawn", "deanna",
    "debbie", "deborah", "debra", "delaney", "delia", "delilah", "denise", "dela", "desiree", "destiny",
    "diamond", "diana", "diane", "dianna", "dianne", "dina", "dolores", "dominique", "dora", "doris",
    "dorothy", "ebony", "edith", "edna", "eileen", "elaina", "elaine", "eleanor", "elena", "elisa",
    "elisabeth", "elise", "eliza", "ella", "ellen", "ellie", "elsa", "elsie", "elvira", "elyse",
    "emelia", "emely", "emerson", "emilee", "emilia", "emily", "erica", "erika", "erin", "esmeralda",
    "esperanza", "essence", "estella", "estelle", "esther", "estrella", "eugenia", "eunice", "eva", "eve",
    "evelyn", "faith", "fatima", "faye", "felicia", "fernanda", "fiona", "flora", "florence", "frances",
    "francesca", "francine", "gabriela", "gabriella", "gabrielle", "gail", "genesis", "genevieve", "georgia",
    "geraldine", "gertrude", "gia", "giana", "gianna", "gillian", "gina", "ginger", "giovanna", "gladys",
    "glenda", "gloria", "goldie", "gracelyn", "gracie", "graciela", "greta", "gretchen", "guadalupe", "gwen",
    "gwendolyn", "hailey", "haley", "halle", "hanna", "hannah", "harper", "harriet", "hazel", "heaven",
    "heidi", "helen", "helena", "hilary", "hillary", "hollie", "holly", "hope", "ida", "ileen",
    "iliana", "imani", "india", "ingrid", "iris", "irma", "isabel", "isabela", "isabella", "isabelle",
    "isla", "itzel", "ivana", "ivy", "jacqueline", "jada", "jade", "jaelyn", "jaida", "jaime",
    "jaimie", "jaliyah", "jana", "jane", "janelle", "janessa", "janet", "janette", "janice", "janie",
    "janine", "jayda", "jayla", "jayleen", "jaylene", "jazlyn", "jazmin", "jazmine", "jean", "jeanette",
    "jeanne", "jeannette", "jemma", "jenna", "jennie", "jenny", "jessenia", "jessie", "jewel", "jill",
    "jillian", "joan", "joann", "joanna", "joanne", "jocelyn", "jodi", "jodie", "jody", "johanna",
    "johnnie", "jolene", "jordyn", "josephine", "josie", "joy", "joyce", "juana", "juanita", "judith",
    "judy", "julia", "juliana", "julianna", "julie", "juliet", "julieta", "juliette", "june", "justine",
    "kadence", "kaelyn", "kaia", "kailyn", "kaitlin", "kaitlyn", "kaiya", "kaley", "kali", "kallie",
    "kamila", "karina", "karla", "karlee", "karly", "kasey", "kassandra", "kate", "katelyn", "katelynn",
    "kathleen", "kathryn", "kathy", "katrina", "kay", "kaydence", "kaylee", "kayleigh", "kaylie", "kaylin",
    "keely", "keira", "kelli", "kellie", "kelsey", "kelsie", "kendall", "kendra", "kenia", "kenzie",
    "keyla", "khloe", "kia", "kiara", "kiera", "kierra", "kiley", "kimberly", "kira", "kirsten",
    "krista", "kristen", "kristi", "kristie", "kristin", "kristina", "kristine", "kristy", "krystal", "kyla",
    "kylee", "kyleigh", "kylie", "kyra", "lacey", "laila", "lana", "lara", "larissa", "latoya",
    "laurel", "lauryn", "layla", "leah", "leann", "leanna", "leanne", "leia", "leila", "leilani",
    "lena", "lenora", "leona", "lesley", "leslie", "lesly", "leticia", "lexi", "lexie", "lia",
    "liana", "lila", "lilian", "liliana", "lillian", "lilliana", "lillie", "lilly", "lily", "lilyana",
    "lina", "lizbeth", "lizeth", "lizette", "lola", "london", "lora", "lorena", "loretta", "lori",
    "lorna", "lorraine", "louise", "lucia", "lucille", "lucy", "luisa", "luna", "lupita", "luz",
    "lydia", "lyla", "lynn", "lynnette", "mabel", "macey", "maci", "macie", "mackenzie", "macy",
    "madalyn", "madeline", "madelyn", "madilyn", "madison", "mae", "maeve", "magdalena", "maggie", "maia",
    "makayla", "makenna", "makenzie", "malia", "mallory", "mandy", "mara", "marcella", "marcia", "margaret",
    "margarita", "margo", "marguerite", "maria", "mariah", "mariam", "mariana", "marianna", "maribel", "maricela",
    "mariela", "marilyn", "marina", "marisa", "marisol", "marissa", "maritza", "marjorie", "marla", "marlee",
    "marlene", "martha", "martina", "mary", "maryam", "mason", "matilda", "mattie", "maureen", "mavis",
    "maxine", "may", "maya", "mayra", "mckayla", "mckenna", "mckenzie", "meagan", "meaghan", "melanie",
    "melany", "melina", "melinda", "melissa", "melody", "mercedes", "meredith", "mia", "micaela", "micah",
    "michaela", "michele", "miguelina", "mikaela", "mikayla", "mila", "milan", "milania", "mildred", "milena",
    "miley", "mina", "miranda", "mireya", "miriam", "miya", "moira", "mollie", "molly", "mona",
    "monique", "myah", "myra", "myrna", "nadine", "natalia", "natalie", "natasha", "nathalie", "nayeli",
    "neha", "nella", "nellie", "neveah", "nia", "nichole", "nikki", "nina", "noelle", "noemi",
    "nola", "nora", "norma", "nova", "octavia", "ofelia", "olga", "olive", "onyx", "paige",
    "paisley", "paloma", "pam", "paola", "patrice", "patty", "paula", "paulette", "pearl", "peggy",
    "penelope", "perla", "phoebe", "piper", "priscilla", "prudence", "queen", "rachael", "rachelle", "raegan",
    "raelyn", "raelynn", "rain", "ramona", "raquel", "raven", "raya", "reagan", "reanna", "rebekah",
    "reese", "regina", "reign", "reina", "reyna", "rhea", "rhonda", "ria", "rita", "roberta",
    "rochelle", "romina", "rosa", "rosalie", "rosalinda", "rosalyn", "rose", "rosemary", "roxanne", "ruby",
    "ruth", "ryann", "sabrina", "sadie", "sage", "saige", "sally", "samara", "sandy", "saniyah",
    "sarahi", "sarina", "sasha", "savanna", "scarlet", "scarlett", "selah", "selena", "selene", "serena",
    "serenity", "shania", "shannon", "shawna", "sheila", "shelby", "shelley", "shelly", "sheri", "sherri",
    "sherry", "shirley", "shyann", "siena", "sienna", "sierra", "simone", "skyla", "skylar", "skyler",
    "sloan", "sofia", "sonia", "sonya", "sophie", "stacey", "staci", "stacie", "stacy", "stella",
    "stefanie", "stephanie", "sue", "summer", "susana", "susanna", "suzanne", "sydney", "sylvia", "tabitha",
    "taisha", "talia", "tamara", "tameka", "tami", "tamika", "tammie", "tammy", "tania", "tanya",
    "tara", "taryn", "tatiana", "tatum", "tatyana", "taya", "teagan", "teresa", "teri", "terra",
    "tess", "tessa", "thalia", "thea", "theresa", "tia", "tiana", "tianna", "tiara", "tierra",
    "tina", "tori", "tracey", "traci", "tracie", "tracy", "trinity", "trisha", "trista", "valeria",
    "valerie", "valery", "vanessa", "velma", "vera", "veronica", "vicki", "vickie", "viola", "violet",
    "vivian", "viviana", "wanda", "whitney", "willow", "winnie", "xena", "xiomara", "yadira", "yamileth",
    "yareli", "yaretzi", "yasmin", "yeardley", "yesenia", "yolanda", "yvette", "yvonne", "zahra", "zaria",
    "zariah", "zoe", "zoey"
  ]);

  // 从DOM元素提取用户信息 - 优化支持评论区和列表用户卡片
  function extractUserInfo(element) {
    try {
      let screenName = null;
      let displayName = null;

      const usernameSpans = element.querySelectorAll("span");
      for (const span of usernameSpans) {
        const text = span.textContent.trim();
        if (text.startsWith("@") && text.length > 1) {
          screenName = text.substring(1);
          break;
        }
      }

      if (!screenName) {
        const userLinks = element.querySelectorAll('a[href*="/"]');
        for (const link of userLinks) {
          const href = link.getAttribute("href");
          if (
            href &&
            href.startsWith("/") &&
            !href.includes("/status/") &&
            !href.includes("/photo/") &&
            !href.includes("/explore") &&
            !href.includes("/notifications") &&
            !href.includes("/messages")
          ) {
            const match = href.match(/^\/([^\/\?]+)/);
            if (match && match[1]) {
              screenName = match[1];
              break;
            }
          }
        }
      }

      const nameElement = element.querySelector(
        '[data-testid="User-Name"], [data-testid="UserName"]'
      );
      if (nameElement) {
        const spans = nameElement.querySelectorAll("span");
        for (const span of spans) {
          if (span.textContent && !span.textContent.startsWith("@")) {
            displayName = span.textContent.trim();
            break;
          }
        }
      }

      if (!screenName) {
        const profileLink = element.querySelector('a[href^="/"][href$=""]');
        if (profileLink) {
          const href = profileLink.getAttribute("href");
          const match = href.match(/^\/([^\/\?]+)/);
          if (match && match[1]) screenName = match[1];
        }
      }

      if (!screenName) {
        const parent = element.closest('[data-testid="tweet"]') || element.closest("article") || element.closest('[data-testid="UserCell"]');
        if (parent) {
          const parentLinks = parent.querySelectorAll('a[href^="/"]');
          for (const link of parentLinks) {
            const href = link.getAttribute("href");
            const match = href.match(/^\/([^\/\?]+)/);
            if (match && match[1] && !href.includes("/status/")) {
              screenName = match[1];
              break;
            }
          }
        }
      }

      return { screenName, displayName, userId: null };
    } catch (error) {
      console.log("❌ 提取用户信息失败:", error.message);
      return null;
    }
  }

  // 检查是否匹配女性名字黑名单 (子串匹配)
  function isFemaleNameBlacklisted(name, screenName) {
    const lowerName = (name || '').toLowerCase();
    const lowerScreen = (screenName || '').toLowerCase();
    return Array.from(femaleNamesBlacklist).some(item => lowerName.includes(item) || lowerScreen.includes(item));
  }

  // 检查是否匹配粉丝/关注数条件
  function shouldDisplayUserInfo(userInfo, screenName) {
    if (!userInfo || userInfo.followersCount === undefined || userInfo.friendsCount === undefined) {
      console.log(`🚫 ${screenName}: 数据无效或缺失`);
      return { shouldDisplay: false, reason: '数据无效' };
    }

    if (userInfo.followersCount >= 1000 || userInfo.friendsCount >= 1000) {
      console.log(`🚫 ${screenName}: 大V账户 (粉丝:${userInfo.followersCount}, 关注:${userInfo.friendsCount})`);
      return { shouldDisplay: false, reason: '大V账户' };
    }

    if (userInfo.followersCount > userInfo.friendsCount) {
      console.log(`🚫 ${screenName}: 粉丝数量超过关注数量 (粉丝:${userInfo.followersCount}, 关注:${userInfo.friendsCount})`);
      return { shouldDisplay: false, reason: '狗推较多' };
    }

    return { shouldDisplay: true, reason: '' };
  }

  // 创建过滤原因提示
  function createFilterReasonDisplay(cardElement, screenName, reason) {
    const oldDisplay = cardElement.querySelector('[data-filter-reason="display"]');
    if (oldDisplay) oldDisplay.remove();

    const displayDiv = document.createElement('div');
    displayDiv.setAttribute('data-filter-reason', 'display');
    displayDiv.style.fontSize = '11px';
    displayDiv.style.color = '#e0245e';
    displayDiv.style.marginTop = '2px';
    displayDiv.style.lineHeight = '1.1';
    displayDiv.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    displayDiv.style.fontWeight = 'bold';
    displayDiv.textContent = `🚫 ${reason}`;

    let contentContainer = cardElement.querySelector('[data-testid="tweetText"]')?.parentNode ||
                          cardElement.querySelector('[data-testid="UserDescription"]')?.parentNode ||
                          cardElement.querySelector('.r-1iusvr4.r-16y2uox');

    if (contentContainer) {
      contentContainer.appendChild(displayDiv);
      console.log(`📋 过滤原因显示: ${screenName} - ${reason}`);
    }
  }

  // 生成transaction ID
  function generateTransactionId() {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // GraphQL哈希缓存
  const HASH_CACHE_KEY = "x_graphql_hash_cache";
  const HASH_CACHE_EXPIRY = 24 * 60 * 60 * 1000;

  function getCachedHash(operationName) {
    try {
      const cache = JSON.parse(localStorage.getItem(HASH_CACHE_KEY) || "{}");
      const entry = cache[operationName];
      if (entry && Date.now() - entry.timestamp < HASH_CACHE_EXPIRY) {
        return entry.hash;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function setCachedHash(operationName, hash) {
    try {
      const cache = JSON.parse(localStorage.getItem(HASH_CACHE_KEY) || "{}");
      cache[operationName] = { hash, timestamp: Date.now() };
      localStorage.setItem(HASH_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.log("哈希缓存失败:", e);
    }
  }

  // 从main.js自动提取哈希
  async function autoExtractHash() {
    try {
      const script = document.querySelector(
        'script[src*="responsive-web/client-web/main."]'
      );
      if (!script) {
        console.log("⚠️ 未找到main.js脚本标签");
        return false;
      }
      const jsUrl = script.src;
      console.log(`🔍 提取哈希从: ${jsUrl}`);

      const response = await fetch(jsUrl);
      if (!response.ok) {
        console.log("❌ Fetch main.js失败");
        return false;
      }
      const jsText = await response.text();

      const match =
        jsText.match(
          /"UserByScreenName"(?:\s*:\s*|,\s*)"([a-fA-F0-9]{21}|[a-zA-Z0-9\-]{27})"/
        ) ||
        jsText.match(
          /UserByScreenName\s*:\s*"([a-fA-F0-9]{21}|[a-zA-Z0-9\-]{27})"/
        );
      if (match && match[1]) {
        const hash = match[1];
        setCachedHash("UserByScreenName", hash);
        console.log(`✅ 从main.js自动提取哈希: ${hash}`);
        return true;
      } else {
        console.log("⚠️ main.js中未找到UserByScreenName哈希");
        return false;
      }
    } catch (error) {
      console.log("❌ 自动提取哈希出错:", error.message);
      return false;
    }
  }

  // 拦截GraphQL请求以动态获取哈希
  let originalFetch = null;
  function interceptGraphQLRequests() {
    if (originalFetch) return;

    originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = args[0];
      if (typeof url === 'string' && url.includes("UserByScreenName")) {
        try {
          const hashMatch = url.match(
            /graphql\/([a-fA-F0-9\-]{21,27})\/UserByScreenName/
          );
          if (hashMatch && hashMatch[1]) {
            const hash = hashMatch[1];
            setCachedHash("UserByScreenName", hash);
            console.log(`✅ 动态捕获哈希: ${hash} (从 ${url})`);
          }
        } catch (e) {
          console.log("拦截解析失败:", e);
        }
      }

      const response = await originalFetch.apply(this, args);

      // 检测429错误
      if (!response.ok && response.status === 429) {
        console.log("⚠️ 检测到429速率限制");
      }

      return response;
    };
    console.log("🔍 GraphQL请求拦截已启用");
  }

  // 通过API获取单个用户详细信息
  async function getUserInfoFromAPI(screenName) {
    const cached = getCache(screenName);
    if (cached) {
      console.log(`📦 从缓存获取: ${screenName}`);
      return cached;
    }

    const failCacheKey = `x_user_fail_${screenName}`;
    const failEntry = JSON.parse(localStorage.getItem(failCacheKey) || "{}");
    if (failEntry.timestamp && Date.now() - failEntry.timestamp < 60 * 60 * 1000) {
      const failReason = failEntry.reason || '未知错误';
      console.log(`⏭️ 跳过重复API调用 (失败缓存): ${screenName} - ${failReason}`);
      return { error: failReason };
    }

    if (!screenName) {
      console.log("❌ screenName为空，无法调用API");
      return null;
    }

    try {
      const auth = getTwitterAuth();
      if (!auth) {
        console.log("❌ 无法获取认证信息");
        return null;
      }

      let hash = getCachedHash("UserByScreenName");
      if (!hash) {
        console.log("⚠️ 未捕获GraphQL哈希。使用引导值初始化。");
        hash = "rDqpmDM1PbobgbmcmFKjug"; // 2025年10月15日更新引导哈希
        setCachedHash("UserByScreenName", hash);
      }

      const apiUrl = `https://x.com/i/api/graphql/${hash}/UserByScreenName`;

      const variables = {
        screen_name: screenName,
        withGrokTranslatedBio: false,
        withSafetyModeUserFields: true,
      };

      const features = {
        blue_business_profile_image_shape_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        rfox_enabled: true,
        blue_business_profile_image_shape_enabled: true,
        hidden_profile_subscriptions_enabled: true,
        payments_enabled: false,
        rweb_xchat_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_grok_bio_auto_translation_is_enabled: false,
        grok_bio_auto_translation_enabled: false,
        responsive_web_grok_translation_enabled: false,
      };

      const fieldToggles = {
        withAuxiliaryUserLabels: true,
      };

      const headers = {
        accept: "*/*",
        "accept-language":
          "zh,zh-TW;q=0.9,zh-CN;q=0.8,zh-HK;q=0.7,en-US;q=0.6,en;q=0.5",
        authorization: auth.bearerToken,
        "content-type": "application/json",
        priority: "u=1, i",
        "sec-ch-ua":
          '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "x-client-transaction-id": generateTransactionId(),
        "x-csrf-token": auth.csrfToken,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
      };

      if (auth.cookieString) {
        headers.Cookie = auth.cookieString;
      }

      const urlParams = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
        fieldToggles: JSON.stringify(fieldToggles),
      });

      console.log(`🔗 API请求: ${screenName}`, {
        url: apiUrl,
        hash,
        authComplete: auth.isComplete,
        cookieLength: auth.cookieString?.length || 0,
      });

      const response = await fetch(`${apiUrl}?${urlParams}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorReason = response.status === 429 ? '429速率限制' : `${response.status} ${response.statusText}`;
        console.log(`❌ API 调用失败: ${screenName} - ${errorReason}`);
        try {
          const errorText = await response.text();
          console.log("❌ 错误详情:", errorText.substring(0, 200));
        } catch (e) {
          console.log("❌ 无法获取错误详情");
        }
        localStorage.setItem(failCacheKey, JSON.stringify({
          timestamp: Date.now(),
          reason: errorReason
        }));
        return { error: errorReason };
      }

      const data = await response.json();
      const user = data.data?.user?.result;

      if (!user || !user.legacy) {
        console.log(`❌ 未找到有效用户信息: ${screenName}`, data);
        localStorage.setItem(failCacheKey, JSON.stringify({
          timestamp: Date.now(),
          reason: '用户数据无效'
        }));
        return { error: '用户数据无效' };
      }

      const userInfo = {
        id: user.rest_id,
        screenName: user.legacy.screen_name,
        name: user.legacy.name || user.screenName || "未知用户",
        description: user.legacy.description || "",
        followersCount: user.legacy.followers_count || 0,
        friendsCount: user.legacy.friends_count || 0,
        following: user.relationship_perspectives?.following || false,
      };

      console.log(`📊 API响应解析: ${screenName}`);
      console.log(`  - 完整userInfo:`, userInfo);

      setCache(screenName, userInfo);

      console.log(`✅ API 成功获取用户信息: ${user.legacy?.name || screenName}`);
      return userInfo;
    } catch (error) {
      const errorReason = error.message || '网络错误';
      console.log(`❌ API 调用出错: ${screenName} - ${errorReason}`);
      localStorage.setItem(failCacheKey, JSON.stringify({
        timestamp: Date.now(),
        reason: errorReason
      }));
      return { error: errorReason };
    }
  }

  // 批量获取多个用户信息 - 优化为并行处理与限流
  async function getUsersInfoFromAPI(screenNames) {
    console.log(`🚀 开始批量查询 ${screenNames.length} 个用户...`);
    const results = {};
    const BATCH_SIZE = 5; // 每批5个请求
    const BATCH_DELAY = 1000; // 批次间延迟1秒，避免速率限制

    for (let i = 0; i < screenNames.length; i += BATCH_SIZE) {
      const batch = screenNames.slice(i, i + BATCH_SIZE);
      console.log(`📦 处理批次 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(", ")}`);

      const promises = batch.map(async (screenName) => {
        return { screenName, info: await getUserInfoFromAPI(screenName) };
      });

      const batchResults = await Promise.allSettled(promises);
      batchResults.forEach((result) => {
        if (result.status === "fulfilled") {
          const { screenName, info } = result.value;
          results[screenName] = info;
        } else {
          console.log(`⚠️ 查询失败: ${result.reason}`);
        }
      });

      if (i + BATCH_SIZE < screenNames.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
      }
    }

    console.log(`✅ 批量查询完成: 成功 ${Object.keys(results).filter(k => !results[k]?.error).length}/${screenNames.length}`);
    return results;
  }

  // 在卡片内创建显示元素 - 适应不同卡片类型（推文/列表），确保显示在下方
  function createCardDisplay(cardElement, detailedUserInfo) {
    // 移除可能存在的旧显示元素
    const oldDisplay = cardElement.querySelector('[data-user-stats="display"]');
    if (oldDisplay) oldDisplay.remove();

    // 检查是否已标记为显示
    const uniqueId = detailedUserInfo.screenName ? `displayed-${detailedUserInfo.screenName}` : null;
    if (cardElement.dataset.uniqueDisplayId === uniqueId) {
      console.log(`⏭️ 跳过重复显示: ${detailedUserInfo.name} (ID: ${uniqueId})`);
      return;
    }

    const displayDiv = document.createElement('div');
    displayDiv.setAttribute('data-user-stats', 'display');
    displayDiv.style.fontSize = '12px';
    displayDiv.style.color = '#71767b';  // 恢复为灰色
    displayDiv.style.marginTop = '4px';
    displayDiv.style.lineHeight = '1.2';
    displayDiv.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    const followersDiv = document.createElement('div');
    followersDiv.textContent = `粉丝数：${detailedUserInfo.followersCount.toLocaleString()} 关注数：${detailedUserInfo.friendsCount.toLocaleString()}`;

    const descriptionDiv = document.createElement('div');
    descriptionDiv.textContent = `个人简介：${detailedUserInfo.description || '无'}`;

    displayDiv.appendChild(followersDiv);
    displayDiv.appendChild(descriptionDiv);

    let contentContainer = cardElement.querySelector('[data-testid="tweetText"]')?.parentNode;

    // 对于关注列表卡片
    if (!contentContainer) {
      contentContainer = cardElement.querySelector('[data-testid="UserDescription"]')?.parentNode;
    }

    // 后备方案
    if (!contentContainer) {
      contentContainer = cardElement.querySelector('.r-1iusvr4.r-16y2uox');
    }

    if (contentContainer) {
      contentContainer.appendChild(displayDiv);
      console.log(`✅ 附加显示到内容容器: ${detailedUserInfo.name}`);
      // 移除lang属性以让浏览器翻译插件自动检测语言
      // 触发DOM变更事件以尝试激活浏览器翻译
      contentContainer.dispatchEvent(new Event('DOMSubtreeModified', { bubbles: true }));
    } else {
      console.log(`⚠️ 未找到内容容器: ${detailedUserInfo.name}`);
    }

    cardElement.dataset.uniqueDisplayId = uniqueId;
    console.log(`✅ 文本显示完成: ${detailedUserInfo.name}`);
  }

  // 处理用户卡片
  function processUserCard(cardElement) {
    if (cardElement.dataset.processed) return;
    cardElement.dataset.processed = "true";
    cardElement.detailedUserInfo = null;
    cardElement.dataset.uniqueDisplayId = "";
  }

  // 检查登录状态
  function checkLoginStatus() {
    try {
      const loginElements = document.querySelectorAll(
        '[data-testid="loginButton"], [href="/login"], [href="/i/flow/login"]'
      );
      if (loginElements.length > 0) {
        console.log("❌ 检测到登录按钮");
        return false;
      }

      const userMenu = document.querySelector(
        '[data-testid="SideNav_AccountSwitcher_Button"]'
      );
      if (!userMenu) {
        console.log("❌ 未找到用户菜单");
        return false;
      }

      const auth = getTwitterAuth();
      if (!auth || (!auth.csrfToken && !auth.authToken && !auth.twitterSession)) {
        console.log("❌ 缺少必要的认证cookies");
        return false;
      }

      console.log("✅ 登录状态检查通过");
      return true;
    } catch (error) {
      console.log("❌ 登录状态检查失败:", error.message);
      return false;
    }
  }

  // 显示登录提示
  function showLoginPrompt() {
    console.log("❌ 请先登录 Twitter/X 账户后再使用脚本");

    const loginTip = document.createElement("div");
    loginTip.style.position = "fixed";
    loginTip.style.bottom = "20px";
    loginTip.style.right = "20px";
    loginTip.style.backgroundColor = "#fff3cd";
    loginTip.style.color = "#856404";
    loginTip.style.padding = "16px 20px";
    loginTip.style.borderRadius = "8px";
    loginTip.style.fontSize = "14px";
    loginTip.style.fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    loginTip.style.border = "1px solid #ffeaa7";
    loginTip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    loginTip.style.zIndex = "10000";
    loginTip.style.maxWidth = "300px";

    loginTip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">🔒 需要登录</div>
      <div style="line-height: 1.4;">请先登录 Twitter/X 账户，然后刷新页面</div>
    `;

    document.body.appendChild(loginTip);
    setTimeout(() => {
      if (loginTip.parentNode) loginTip.parentNode.removeChild(loginTip);
    }, 5000);
  }

  // 主函数
  async function initFollowerDisplay() {
    if (!checkLoginStatus()) {
      showLoginPrompt();
      return;
    }

    interceptGraphQLRequests();
    await autoExtractHash();

    if (!getCachedHash("UserByScreenName")) {
      setCachedHash("UserByScreenName", "rDqpmDM1PbobgbmcmFKjug");
      console.log(
        '🔧 使用2025年10月15日更新引导哈希: rDqpmDM1PbobgbmcmFKjug (动态捕获将覆盖此值，兼容2025年10月)'
      );
    }

    console.log(
      "🚀 用户卡片自动显示脚本已启动 (GraphQL批量自动版 v2.32.15 - 兼容2025年10月，支持过滤原因显示，优化翻译插件兼容，API请求并行处理与限流，支持视图可见性动态显示/隐藏)"
    );

    let isProcessing = false;
    let lastProcessTime = 0;

    const userCardSelectors = [
      'article[data-testid="tweet"]',
      'div[data-testid="tweet"]',
      '[data-testid="UserCell"]',
      '[data-testid="cellInnerDiv"]',
      '[data-testid="reply"]',
      'div[role="article"]',
    ];

    const observers = new Map(); // 存储每个卡片的IntersectionObserver

    async function processVisibleCards(mutations) {
      const now = Date.now();
      if (isProcessing || now - lastProcessTime < 2000) {
        console.log(`⏸️ 节流跳过处理 (间隔: ${now - lastProcessTime}ms)`);
        return;
      }
      lastProcessTime = now;
      isProcessing = true;

      let elements = [];
      for (const selector of userCardSelectors) {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      }

      elements = [...new Set(elements)];

      if (elements.length === 0) {
        console.log("📋 未找到用户卡片");
        isProcessing = false;
        return;
      }

      const newElements = elements.filter(
        (element) =>
          !element.dataset.processed &&
          !element.querySelector('[data-user-stats="display"], [data-filter-reason="display"]') &&
          element.closest('[data-user-stats="display"], [data-filter-reason="display"]') === null &&
          (element.closest('[data-testid="tweet"]') === element || element.closest('[data-testid="UserCell"]') === element)
      );

      console.log(`📋 发现 ${newElements.length} 个新用户卡片 (自动批量加载中...)`);

      newElements.forEach(processUserCard);

      const screenNameSet = new Set();
      newElements.forEach((el) => {
        const info = extractUserInfo(el);
        if (info?.screenName && !getCache(info.screenName) && !screenNameSet.has(info.screenName)) {
          if (isFemaleNameBlacklisted(info.displayName, info.screenName)) {
            console.log(`👩 ${info.screenName}: 女性名字黑名单匹配`);
            createFilterReasonDisplay(el, info.screenName, '女性名字');
          } else {
            screenNameSet.add(info.screenName);
          }
        }
      });
      const uniqueScreenNames = Array.from(screenNameSet);

      let batchResults = {};
      if (uniqueScreenNames.length > 0) {
        batchResults = await getUsersInfoFromAPI(uniqueScreenNames);
      }

      newElements.forEach((el) => {
        const info = extractUserInfo(el);
        if (info?.screenName) {
          let userInfo = batchResults[info.screenName] || getCache(info.screenName);

          if (userInfo && userInfo.error) {
            createFilterReasonDisplay(el, info.screenName, userInfo.error);
          } else if (userInfo) {
            el.detailedUserInfo = userInfo;
            // 不立即显示，使用IntersectionObserver控制
            setupIntersectionObserver(el);
          } else {
            console.log(`🚫 ${info.screenName}: 无有效数据`);
          }
        }
      });

      isProcessing = false;
      console.log(`✅ 自动批量处理完成: ${newElements.length} 个卡片`);
    }

    function setupIntersectionObserver(cardElement) {
      if (observers.has(cardElement)) return;

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            showUserInfo(cardElement);
          } else {
            hideUserInfo(cardElement);
          }
        });
      }, { threshold: 0.1 });

      observer.observe(cardElement);
      observers.set(cardElement, observer);
    }

    function showUserInfo(cardElement) {
      if (!cardElement.detailedUserInfo) return;

      const checkResult = shouldDisplayUserInfo(cardElement.detailedUserInfo, cardElement.detailedUserInfo.screenName);
      if (checkResult.shouldDisplay) {
        createCardDisplay(cardElement, cardElement.detailedUserInfo);
      } else {
        createFilterReasonDisplay(cardElement, cardElement.detailedUserInfo.screenName, checkResult.reason);
      }
    }

    function hideUserInfo(cardElement) {
      const display = cardElement.querySelector('[data-user-stats="display"], [data-filter-reason="display"]');
      if (display) {
        display.remove();
      }
      cardElement.dataset.uniqueDisplayId = ""; // 重置以允许重新显示
    }

    const observer = new MutationObserver((mutations) => {
      // 忽略脚本自身添加的节点以避免无限循环
      if (mutations.some(mutation => Array.from(mutation.addedNodes).some(node => node.matches && (node.matches('[data-user-stats="display"]') || node.matches('[data-filter-reason="display"]'))))) {
        return;
      }
      setTimeout(processVisibleCards, 2000);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(processVisibleCards, 2000);

    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "h") {
        e.preventDefault();
        processVisibleCards();
      }
    });
  }

  console.log(
    "🔧 用户卡片自动显示脚本已加载 (GraphQL批量自动版 v2.32.15 - 兼容2025年10月，支持过滤原因显示，优化翻译插件兼容，API请求并行处理与限流，支持视图可见性动态显示/隐藏)"
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(initFollowerDisplay, 2000);
    });
  } else {
    setTimeout(initFollowerDisplay, 2000);
  }
})();
