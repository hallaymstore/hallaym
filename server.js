const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient, ServerApiVersion } = require('mongodb');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  const runtimeOverrideKeys = new Set(['PORT', 'HOST']);
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) {
      continue;
    }
    if (runtimeOverrideKeys.has(key)) {
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
      }
      continue;
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SITE_URL = process.env.SITE_URL || 'https://hallaym.com';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'hallaym_session';
const VISITOR_COOKIE = 'hallaym_visitor';
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'hallaym-news-2026-feed-key';
const staticPageCache = new Map();
const mongoConfig = {
  uri: process.env.MONGODB_URI || '',
  dbName: process.env.MONGODB_DB_NAME || 'hallaym_newsroom',
};
const cloudinaryConfig = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  apiKey: process.env.CLOUDINARY_API_KEY || '',
  apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || '',
  folder: process.env.CLOUDINARY_FOLDER || 'hallaym-newsroom',
};
const defaultAdminConfig = {
  name: process.env.DEFAULT_ADMIN_NAME || 'Hallaym Admin',
  email: String(process.env.DEFAULT_ADMIN_EMAIL || 'admin@hallaym.com').trim().toLowerCase(),
  password: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin#2026',
  title: process.env.DEFAULT_ADMIN_TITLE || 'Bosh muharrir',
  bio: process.env.DEFAULT_ADMIN_BIO || 'Tahririy sifat, mualliflar va nashr xavfsizligi uchun mas\'ul.',
};
const runtimeState = {
  mongo: {
    enabled: Boolean(mongoConfig.uri),
    connected: false,
    error: null,
    client: null,
    db: null,
  },
  cloudinary: {
    enabled: Boolean(cloudinaryConfig.cloudName),
  },
};

const categoryCatalog = [
  { slug: 'technology', label: 'Texnologiya' },
  { slug: 'business', label: 'Biznes' },
  { slug: 'society', label: 'Jamiyat' },
  { slug: 'world', label: 'Jahon' },
  { slug: 'sports', label: 'Sport' },
  { slug: 'culture', label: 'Madaniyat' },
];

function categoryLabel(slug) {
  return categoryCatalog.find((item) => item.slug === slug)?.label || 'Yangiliklar';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashPassword(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function randomId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    ...options,
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function minutesToRead(wordCount) {
  return Math.max(1, Math.ceil(wordCount / 210));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, piece) => {
    const index = piece.indexOf('=');
    if (index === -1) {
      return acc;
    }
    const key = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (key) {
      acc[key] = decodeURIComponent(value);
    }
    return acc;
  }, {});
}

function appendSetCookie(res, cookieValue) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieValue]);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [existing, cookieValue]);
}

function cookieString(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (options.sameSite !== false) {
    parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function send(res, statusCode, body, contentType = 'text/html; charset=utf-8', extraHeaders = {}) {
  if (res.writableEnded) {
    return;
  }
  res.writeHead(statusCode, { 'Content-Type': contentType, ...extraHeaders });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function redirect(res, location, statusCode = 302) {
  send(res, statusCode, '', 'text/plain; charset=utf-8', { Location: location });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('So\'rov tanasi juda katta.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('So‘rov formati noto‘g‘ri.'));
      }
    });
    req.on('error', reject);
  });
}

function getStaticPage(name) {
  if (staticPageCache.has(name)) {
    return staticPageCache.get(name);
  }
  const filePath = path.join(PUBLIC_DIR, name);
  const content = fs.readFileSync(filePath, 'utf8');
  staticPageCache.set(name, content);
  return content;
}

const settings = {
  siteUrl: SITE_URL,
  brand: {
    siteName: 'Hallaym Newsroom',
    shortName: 'Hallaym',
    accent: 'News',
    logoUrl: '',
    logoPublicId: '',
    tagline: 'Rasmiy, tezkor va ishonchli yangiliklar maydoni',
    announcement: 'Hallaym yangiliklari tezkor nashr, mualliflik shaffofligi va sifatli taqdimot tamoyillari asosida tayyorlanadi.',
    heroTitle: 'hallaym.com uchun premium yangiliklar maydoni',
    heroDescription:
      'Qidiruvga mos ko‘rinish, muallif profillari, boshqaruv nazorati, tungi rejim va bildirishnomalar bir joyda ishlaydi.',
    ownerName: 'Hallaym Media Group',
    newsroomEmail: 'editor@hallaym.com',
    phone: '+998 90 770 77 77',
    address: 'Toshkent, Uzbekistan',
    footerAbout:
      'Hallaym mustaqil tahrir jarayoni, shaffof mualliflik va ishonchli taqdimot tamoyillari asosida ishlaydi.',
    telegram: 'https://t.me/hallaym',
    youtube: 'https://www.youtube.com/@hallaym',
    instagram: 'https://www.instagram.com/hallaym',
    x: 'https://x.com/hallaym',
  },
};

const DEMO_USER_IDS = new Set(['user_zebo', 'user_said', 'user_nilufar', 'user_reader']);
const DEMO_ARTICLE_IDS = new Set(['article_1', 'article_2', 'article_3', 'article_4', 'article_5', 'article_6', 'article_7']);
const DEMO_APPLICATION_IDS = new Set(['application_1']);

const users = [
  {
    id: 'user_admin',
    slug: 'hallaym-admin',
    name: defaultAdminConfig.name,
    email: defaultAdminConfig.email,
    passwordHash: hashPassword(defaultAdminConfig.password),
    role: 'admin',
    title: defaultAdminConfig.title,
    bio: defaultAdminConfig.bio,
    joinedAt: hoursAgo(720),
  },
];

function makeArticle(seed) {
  const paragraphs = seed.sections.flatMap((section) => section.paragraphs.concat(section.bullets || []));
  const wordCount = paragraphs
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return {
    id: seed.id,
    slug: slugify(seed.slug || seed.title),
    title: seed.title,
    kicker: seed.kicker,
    excerpt: seed.excerpt,
    categorySlug: seed.categorySlug,
    categoryLabel: categoryLabel(seed.categorySlug),
    authorId: seed.authorId,
    featured: Boolean(seed.featured),
    publishedAt: hoursAgo(seed.hoursAgo),
    updatedAt: hoursAgo(seed.updatedHoursAgo ?? seed.hoursAgo),
    tags: seed.tags,
    seoTitle: seed.seoTitle || `${seed.title} | ${settings.brand.siteName}`,
    seoDescription: seed.seoDescription || seed.excerpt,
    sections: seed.sections,
    wordCount,
    readingMinutes: minutesToRead(wordCount),
    likes: seed.likes || 0,
    views: seed.views || 0,
    status: seed.status || 'published',
    location: seed.location || 'Toshkent',
    language: 'uz',
    imageUrl: seed.imageUrl || '',
    imagePublicId: seed.imagePublicId || '',
    sourceLinks: normalizeLinks(seed.sourceLinks || []),
    mediaAssets: normalizeMediaAssets(seed.mediaAssets || []),
    externalPosts: normalizeExternalPosts(seed.externalPosts || []),
  };
}

const articles = [];

const store = {
  settings,
  users,
  articles,
  sessions: new Map(),
  analytics: {
    totalVisits: 0,
    uniqueVisitors: new Set(),
    pageViews: {},
  },
  reactions: new Map(),
  subscribers: [],
  authorApplications: [],
  integrations: {
    indexNow: {
      key: INDEXNOW_KEY,
      lastSubmission: null,
      lastError: null,
    },
  },
};

function ensureDefaultAdminUser() {
  const email = defaultAdminConfig.email;
  const passwordHash = hashPassword(defaultAdminConfig.password);
  const existing = store.users.find((user) => String(user.email || '').toLowerCase() === email);
  if (existing) {
    let changed = false;
    const patch = {
      name: existing.name || defaultAdminConfig.name,
      slug: existing.slug || slugify(defaultAdminConfig.name),
      email,
      passwordHash,
      role: 'admin',
      title: existing.title || defaultAdminConfig.title,
      bio: existing.bio || defaultAdminConfig.bio,
      joinedAt: existing.joinedAt || new Date().toISOString(),
    };
    for (const [key, value] of Object.entries(patch)) {
      if (existing[key] !== value) {
        existing[key] = value;
        changed = true;
      }
    }
    return changed;
  }
  store.users.unshift({
    id: 'user_admin',
    slug: slugify(defaultAdminConfig.name) || 'hallaym-admin',
    name: defaultAdminConfig.name,
    email,
    passwordHash,
    role: 'admin',
    title: defaultAdminConfig.title,
    bio: defaultAdminConfig.bio,
    joinedAt: new Date().toISOString(),
  });
  return true;
}

let analyticsPersistTimer = null;
let articlesPersistTimer = null;

function cloneForStorage(value) {
  return JSON.parse(JSON.stringify(value));
}

function purgeDemoSeedDataInMemory() {
  const before = {
    users: store.users.length,
    articles: store.articles.length,
    applications: store.authorApplications.length,
  };
  store.users.splice(
    0,
    store.users.length,
    ...store.users.filter((user) => !DEMO_USER_IDS.has(user.id)),
  );
  store.articles.splice(
    0,
    store.articles.length,
    ...store.articles.filter((article) => !DEMO_ARTICLE_IDS.has(article.id) && !DEMO_USER_IDS.has(article.authorId)),
  );
  store.authorApplications.splice(
    0,
    store.authorApplications.length,
    ...store.authorApplications.filter((application) => !DEMO_APPLICATION_IDS.has(application.id)),
  );
  return (
    before.users !== store.users.length ||
    before.articles !== store.articles.length ||
    before.applications !== store.authorApplications.length
  );
}

async function purgeDemoSeedDataFromMongo() {
  if (!runtimeState.mongo.connected || !runtimeState.mongo.db) {
    return false;
  }
  const [usersResult, articlesResult, applicationsResult] = await Promise.all([
    runtimeState.mongo.db.collection('users').deleteMany({ _id: { $in: [...DEMO_USER_IDS] } }),
    runtimeState.mongo.db.collection('articles').deleteMany({
      $or: [{ _id: { $in: [...DEMO_ARTICLE_IDS] } }, { authorId: { $in: [...DEMO_USER_IDS] } }],
    }),
    runtimeState.mongo.db.collection('authorApplications').deleteMany({ _id: { $in: [...DEMO_APPLICATION_IDS] } }),
  ]);
  return Boolean(usersResult.deletedCount || articlesResult.deletedCount || applicationsResult.deletedCount);
}

async function getCollection(name) {
  if (!runtimeState.mongo.connected || !runtimeState.mongo.db) {
    return null;
  }
  return runtimeState.mongo.db.collection(name);
}

async function persistMetaDoc(id, payload) {
  const collection = await getCollection('meta');
  if (!collection) {
    return;
  }
  await collection.updateOne(
    { _id: id },
    {
      $set: {
        payload: cloneForStorage(payload),
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

async function persistUsers() {
  const collection = await getCollection('users');
  if (!collection) {
    return;
  }
  await collection.deleteMany({});
  if (store.users.length) {
    await collection.insertMany(store.users.map((user) => ({ _id: user.id, ...cloneForStorage(user) })));
  }
}

async function persistArticles() {
  const collection = await getCollection('articles');
  if (!collection) {
    return;
  }
  await collection.deleteMany({});
  if (store.articles.length) {
    await collection.insertMany(store.articles.map((article) => ({ _id: article.id, ...cloneForStorage(article) })));
  }
}

async function persistApplications() {
  const collection = await getCollection('authorApplications');
  if (!collection) {
    return;
  }
  await collection.deleteMany({});
  if (store.authorApplications.length) {
    await collection.insertMany(
      store.authorApplications.map((application) => ({ _id: application.id, ...cloneForStorage(application) })),
    );
  }
}

async function persistSubscribers() {
  const collection = await getCollection('subscribers');
  if (!collection) {
    return;
  }
  await collection.deleteMany({});
  if (store.subscribers.length) {
    await collection.insertMany(store.subscribers.map((subscriber) => ({ _id: subscriber.id, ...cloneForStorage(subscriber) })));
  }
}

async function persistSettings() {
  await persistMetaDoc('settings', store.settings);
}

async function persistAnalytics() {
  await persistMetaDoc('analytics', {
    totalVisits: store.analytics.totalVisits,
    uniqueVisitors: [...store.analytics.uniqueVisitors],
    pageViews: store.analytics.pageViews,
  });
}

function scheduleAnalyticsPersist() {
  if (!runtimeState.mongo.connected) {
    return;
  }
  clearTimeout(analyticsPersistTimer);
  analyticsPersistTimer = setTimeout(() => {
    persistAnalytics().catch((error) => {
      runtimeState.mongo.error = error.message;
      console.error('Analytics persist error:', error);
    });
  }, 350);
}

function scheduleArticlesPersist() {
  if (!runtimeState.mongo.connected) {
    return;
  }
  clearTimeout(articlesPersistTimer);
  articlesPersistTimer = setTimeout(() => {
    persistArticles().catch((error) => {
      runtimeState.mongo.error = error.message;
      console.error('Articles persist error:', error);
    });
  }, 600);
}

async function seedMongoIfNeeded() {
  const usersCollection = await getCollection('users');
  const articlesCollection = await getCollection('articles');
  const applicationsCollection = await getCollection('authorApplications');
  const subscribersCollection = await getCollection('subscribers');
  const metaCollection = await getCollection('meta');
  const userCount = usersCollection ? await usersCollection.countDocuments() : 0;
  const articleCount = articlesCollection ? await articlesCollection.countDocuments() : 0;
  const applicationCount = applicationsCollection ? await applicationsCollection.countDocuments() : 0;
  const subscriberCount = subscribersCollection ? await subscribersCollection.countDocuments() : 0;
  const settingsDoc = metaCollection ? await metaCollection.findOne({ _id: 'settings' }) : null;
  const analyticsDoc = metaCollection ? await metaCollection.findOne({ _id: 'analytics' }) : null;
  if (!runtimeState.mongo.connected) {
    return;
  }
  if (!userCount) {
    await persistUsers();
  }
  if (!articleCount) {
    await persistArticles();
  }
  if (!applicationCount) {
    await persistApplications();
  }
  if (!subscriberCount) {
    await persistSubscribers();
  }
  if (!settingsDoc) {
    await persistSettings();
  }
  if (!analyticsDoc) {
    await persistAnalytics();
  }
}

async function hydrateFromMongo() {
  if (!runtimeState.mongo.connected) {
    return;
  }
  const settingsDoc = await runtimeState.mongo.db.collection('meta').findOne({ _id: 'settings' });
  if (settingsDoc?.payload?.brand) {
    store.settings = settingsDoc.payload;
  }
  const analyticsDoc = await runtimeState.mongo.db.collection('meta').findOne({ _id: 'analytics' });
  if (analyticsDoc?.payload) {
    store.analytics.totalVisits = Number(analyticsDoc.payload.totalVisits || 0);
    store.analytics.uniqueVisitors = new Set(analyticsDoc.payload.uniqueVisitors || []);
    store.analytics.pageViews = analyticsDoc.payload.pageViews || {};
  }
  const usersDocs = await runtimeState.mongo.db.collection('users').find({}).toArray();
  if (usersDocs.length) {
    store.users.splice(
      0,
      store.users.length,
      ...usersDocs.map(({ _id, ...doc }) => ({ ...doc, id: doc.id || String(_id) })),
    );
  }
  const articleDocs = await runtimeState.mongo.db.collection('articles').find({}).toArray();
  if (articleDocs.length) {
    store.articles.splice(
      0,
      store.articles.length,
      ...articleDocs.map(({ _id, ...doc }) => ({
        ...doc,
        id: doc.id || String(_id),
        categoryLabel: categoryLabel(doc.categorySlug),
      })),
    );
  }
  const applicationDocs = await runtimeState.mongo.db.collection('authorApplications').find({}).toArray();
  if (applicationDocs.length) {
    store.authorApplications.splice(
      0,
      store.authorApplications.length,
      ...applicationDocs.map(({ _id, ...doc }) => ({ ...doc, id: doc.id || String(_id) })),
    );
  }
  const subscriberDocs = await runtimeState.mongo.db.collection('subscribers').find({}).toArray();
  if (subscriberDocs.length) {
    store.subscribers.splice(
      0,
      store.subscribers.length,
      ...subscriberDocs.map(({ _id, ...doc }) => ({ ...doc, id: doc.id || String(_id) })),
    );
  }
}

async function initMongo() {
  if (!runtimeState.mongo.enabled) {
    return false;
  }
  try {
    runtimeState.mongo.client = new MongoClient(mongoConfig.uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      serverSelectionTimeoutMS: 2500,
      connectTimeoutMS: 2500,
    });
    await runtimeState.mongo.client.connect();
    runtimeState.mongo.db = runtimeState.mongo.client.db(mongoConfig.dbName);
    runtimeState.mongo.connected = true;
    runtimeState.mongo.error = null;
    await seedMongoIfNeeded();
    await hydrateFromMongo();
    const hadDefaultAdminFix = ensureDefaultAdminUser();
    const hadDemoRecords = await purgeDemoSeedDataFromMongo();
    const hadDemoMemory = purgeDemoSeedDataInMemory();
    if (hadDemoRecords || hadDemoMemory || hadDefaultAdminFix) {
      await Promise.all([persistUsers(), persistArticles(), persistApplications()]);
    }
    return true;
  } catch (error) {
    runtimeState.mongo.connected = false;
    runtimeState.mongo.error = error.message;
    console.error(`MongoDB connection failed, demo fallback is active: ${error.message}`);
    return false;
  }
}

purgeDemoSeedDataInMemory();
ensureDefaultAdminUser();

function getUserById(userId) {
  return store.users.find((user) => user.id === userId) || null;
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    slug: user.slug,
    name: user.name,
    email: user.email,
    role: user.role,
    title: user.title,
    bio: user.bio,
    joinedAt: user.joinedAt,
  };
}

function articleImageUrl(article) {
  return article?.imageUrl || `${store.settings.siteUrl}/media/article/${article.slug}.svg`;
}

function logoUrl() {
  const custom = String(store.settings.brand.logoUrl || '').trim();
  return custom || `${store.settings.siteUrl}/media/logo.svg`;
}

function getPublishedArticles() {
  return store.articles
    .filter((article) => article.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function latestArticles(limit = 6) {
  return getPublishedArticles().slice(0, limit);
}

function featuredArticle() {
  return getPublishedArticles().find((article) => article.featured) || getPublishedArticles()[0] || null;
}

function articleScore(article) {
  const ageHours = Math.max(1, (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60));
  return article.views * 1.3 + article.likes * 5 + (article.featured ? 40 : 0) - ageHours * 0.8;
}

function trendingArticles(limit = 4) {
  return getPublishedArticles()
    .slice()
    .sort((a, b) => articleScore(b) - articleScore(a))
    .slice(0, limit);
}

function authorArticles(authorId) {
  return store.articles
    .filter((article) => article.authorId === authorId)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function findArticleBySlug(slug) {
  return store.articles.find((article) => article.slug === slug) || null;
}

function findArticleById(id) {
  return store.articles.find((article) => article.id === id) || null;
}

function articleToSummary(article) {
  const author = getUserById(article.authorId);
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    kicker: article.kicker,
    excerpt: article.excerpt,
    categorySlug: article.categorySlug,
    categoryLabel: article.categoryLabel,
    author: publicUser(author),
    featured: article.featured,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    tags: article.tags,
    likes: article.likes,
    views: article.views,
    readingMinutes: article.readingMinutes,
    status: article.status,
    imageUrl: articleImageUrl(article),
  };
}

function articleToDetail(article) {
  return {
    ...articleToSummary(article),
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    sections: article.sections,
    wordCount: article.wordCount,
    location: article.location,
    language: article.language,
    imagePublicId: article.imagePublicId,
    sourceLinks: normalizeLinks(article.sourceLinks || []),
    mediaAssets: normalizeMediaAssets(article.mediaAssets || []),
    externalPosts: normalizeExternalPosts(article.externalPosts || []),
    sourceLinksText: lineTextFromLinks(article.sourceLinks || []),
    mediaImagesText: lineTextFromMedia(article.mediaAssets || [], 'image'),
    videoLinksText: lineTextFromMedia(article.mediaAssets || [], 'video'),
    externalPostsText: lineTextFromExternalPosts(article.externalPosts || []),
  };
}

function categoryStats() {
  return categoryCatalog.map((category) => ({
    ...category,
    count: getPublishedArticles().filter((article) => article.categorySlug === category.slug).length,
  }));
}

function relatedArticles(article, limit = 3) {
  return getPublishedArticles()
    .filter((candidate) => candidate.id !== article.id)
    .sort((a, b) => {
      const aScore =
        (a.categorySlug === article.categorySlug ? 30 : 0) +
        a.tags.filter((tag) => article.tags.includes(tag)).length * 4 +
        articleScore(a);
      const bScore =
        (b.categorySlug === article.categorySlug ? 30 : 0) +
        b.tags.filter((tag) => article.tags.includes(tag)).length * 4 +
        articleScore(b);
      return bScore - aScore;
    })
    .slice(0, limit);
}

function analyticsSnapshot() {
  const authorIds = store.users.filter((user) => user.role === 'author').map((user) => user.id);
  const authorPerformance = authorIds.map((authorId) => {
    const author = getUserById(authorId);
    const posts = authorArticles(authorId);
    return {
      author: publicUser(author),
      posts: posts.length,
      views: posts.reduce((sum, article) => sum + article.views, 0),
      likes: posts.reduce((sum, article) => sum + article.likes, 0),
      published: posts.filter((article) => article.status === 'published').length,
      drafts: posts.filter((article) => article.status === 'draft').length,
    pendingReview: posts.filter((article) => article.status === 'pending_review').length,
    };
  });
  return {
    totalVisits: store.analytics.totalVisits,
    uniqueVisitors: store.analytics.uniqueVisitors.size,
    totalUsers: store.users.filter((user) => user.role === 'user').length,
    totalAuthors: store.users.filter((user) => user.role === 'author').length,
    totalArticles: store.articles.length,
    publishedArticles: store.articles.filter((article) => article.status === 'published').length,
    pendingApplications: store.authorApplications.filter((application) => application.status === 'pending').length,
    pendingReviewArticles: store.articles.filter((article) => article.status === 'pending_review').length,
    subscribers: store.subscribers.length,
    authorPerformance,
  };
}

function publisherReadiness(article) {
  const author = getUserById(article.authorId);
  const ageHours = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60);
  const baseChecks = {
    publicUrl: article.status === 'published',
    authorTransparency: Boolean(author && author.bio && author.title),
    description: Boolean(article.seoDescription && article.seoDescription.length >= 80),
    image: true,
    crawlable: true,
    canonical: true,
    structuredData: true,
    sitemap: true,
  };
  const googleScore =
    Number(baseChecks.publicUrl) +
    Number(baseChecks.authorTransparency) +
    Number(baseChecks.description) +
    Number(baseChecks.image) +
    Number(baseChecks.crawlable) +
    Number(baseChecks.canonical) +
    Number(baseChecks.structuredData) +
    Number(baseChecks.sitemap) +
    Number(ageHours <= 72);
  const bingScore =
    Number(baseChecks.publicUrl) +
    Number(baseChecks.description) +
    Number(baseChecks.image) +
    Number(baseChecks.crawlable) +
    Number(baseChecks.sitemap) +
    Number(Boolean(store.integrations.indexNow.key));
  const yahooScore = bingScore + Number(baseChecks.authorTransparency);
  const operaScore =
    Number(baseChecks.publicUrl) +
    Number(baseChecks.description) +
    Number(baseChecks.image) +
    Number(baseChecks.crawlable) +
    Number(baseChecks.sitemap);
  const resolveStatus = (score, max, freshRequired = false) => {
    if (score >= max - 1 && (!freshRequired || ageHours <= 96)) {
      return 'eligible';
    }
    if (score >= Math.ceil(max * 0.65)) {
      return 'review';
    }
    return 'needs-work';
  };
  return {
    google: {
      status: resolveStatus(googleScore, 9, true),
      label: ageHours <= 72 ? 'Google News tayyorgarligi' : 'Qidiruvdagi ko‘rinish',
      note:
        'Haqiqiy ko‘rinish tashqi qidiruv platformalari qaroriga bog‘liq; bu yerda ichki tayyorgarlik baholanadi.',
    },
    bing: {
      status: resolveStatus(bingScore, 6),
      label: 'Qidiruv sifati',
      note:
        'Yangilangan materiallar qidiruv tizimlariga tezroq yetib borishi mumkin, lekin yakuniy ko‘rinish kafolatlanmaydi.',
    },
    yahoo: {
      status: resolveStatus(yahooScore, 7),
      label: 'Yangiliklar oynasi',
      note:
        'Yangiliklar oynalarida chiqish tashqi platformalarning o‘z siyosati va baholashiga bog‘liq.',
    },
    opera: {
      status: resolveStatus(operaScore, 5),
      label: 'Platforma mosligi',
      note:
        'Yangilik o‘quvchi platformalar uchun ochiq, yengil va mobilga mos sahifalar muhim signal bo‘lib xizmat qiladi.',
    },
  };
}

function readStatusBadge(status) {
  if (status === 'published') {
    return { label: 'E’lon qilingan', tone: 'success' };
  }
  if (status === 'pending_review') {
    return { label: 'Boshqaruv tasdig‘ida', tone: 'warning' };
  }
  if (status === 'draft') {
    return { label: 'Qoralama', tone: 'neutral' };
  }
  if (status === 'eligible') {
    return { label: 'Tayyor', tone: 'success' };
  }
  if (status === 'review') {
    return { label: 'Ko‘rib chiqish', tone: 'warning' };
  }
  return { label: 'Ish talab qiladi', tone: 'danger' };
}

function normalizeArticleStatus(value, fallback = 'draft') {
  return ['draft', 'pending_review', 'published'].includes(value) ? value : fallback;
}

function articleStatusLabel(status) {
  return readStatusBadge(status).label;
}


function ensureVisitor(req, res) {
  const cookies = parseCookies(req);
  let visitorId = cookies[VISITOR_COOKIE];
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    appendSetCookie(
      res,
      cookieString(VISITOR_COOKIE, visitorId, {
        httpOnly: false,
        maxAge: 60 * 60 * 24 * 365,
      }),
    );
  }
  store.analytics.totalVisits += 1;
  store.analytics.uniqueVisitors.add(visitorId);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  store.analytics.pageViews[pathname] = (store.analytics.pageViews[pathname] || 0) + 1;
  scheduleAnalyticsPersist();
  return visitorId;
}

function currentUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  const session = store.sessions.get(token);
  if (!session) {
    return null;
  }
  return getUserById(session.userId);
}

function requireRole(req, res, roles) {
  const user = currentUserFromRequest(req);
  if (!user || !roles.includes(user.role)) {
    sendJson(res, 403, { error: 'Bu bo\'lim uchun ruxsat yetarli emas.' });
    return null;
  }
  return user;
}

function sectionText(article) {
  return article.sections
    .map((section) => [section.heading, ...(section.paragraphs || []), ...(section.bullets || [])].filter(Boolean).join(' '))
    .join(' ');
}

function buildPageJsonLd(extra = []) {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: store.settings.brand.siteName,
    url: store.settings.siteUrl,
    logo: {
      '@type': 'ImageObject',
      url: logoUrl(),
    },
    sameAs: [
      store.settings.brand.telegram,
      store.settings.brand.youtube,
      store.settings.brand.instagram,
      store.settings.brand.x,
    ].filter(Boolean),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'newsroom',
      email: store.settings.brand.newsroomEmail,
      telephone: store.settings.brand.phone,
    },
  };
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: store.settings.brand.siteName,
    url: store.settings.siteUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${store.settings.siteUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
  return [organization, website, ...extra];
}

function renderStructuredData(items) {
  return items
    .map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`)
    .join('\n');
}

const siteCss = `
:root {
  color-scheme: light;
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-strong: #ffffff;
  --surface-muted: #f7f7f8;
  --surface-contrast: #111111;
  --line: #e6e6e8;
  --line-strong: #cfcfd4;
  --text: #111111;
  --muted: #666b75;
  --accent: #111111;
  --accent-strong: #000000;
  --accent-soft: #f2f2f3;
  --success: #07865f;
  --warning: #b97805;
  --danger: #c73939;
  --shadow: 0 10px 28px rgba(15, 23, 42, 0.07);
  --shadow-soft: 0 4px 14px rgba(15, 23, 42, 0.05);
  --header-bg: rgba(255, 255, 255, 0.94);
  --field-bg: #ffffff;
  --radius-lg: 10px;
  --radius-md: 8px;
  --radius-sm: 6px;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #000000;
  --surface: #050505;
  --surface-strong: #090909;
  --surface-muted: #101010;
  --surface-contrast: #f8fafc;
  --line: rgba(255, 255, 255, 0.11);
  --line-strong: rgba(255, 255, 255, 0.18);
  --text: #f8fafc;
  --muted: #a6adbb;
  --accent: #d8b56f;
  --accent-strong: #f0d08a;
  --accent-soft: rgba(215, 173, 99, 0.13);
  --success: #5ee0a2;
  --warning: #ffd277;
  --danger: #ff8f8f;
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.72);
  --shadow-soft: 0 6px 18px rgba(0, 0, 0, 0.5);
  --header-bg: rgba(0, 0, 0, 0.88);
  --field-bg: #030303;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  color: var(--text);
  background: var(--bg);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

:root[data-theme="dark"] body { background: #000000; }

img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }
p { margin: 0 0 1rem; }
h1, h2, h3, h4 {
  margin: 0 0 0.85rem;
  font-weight: 700;
  letter-spacing: -0.018em;
  line-height: 1.1;
}

.site-shell {
  width: min(1240px, calc(100% - 32px));
  margin: 0 auto;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid var(--line);
  background: var(--header-bg);
  backdrop-filter: blur(22px) saturate(140%);
  box-shadow: var(--shadow-soft);
}

.site-topline {
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.topline-row,
.topline-meta,
.topline-links,
.nav-row,
.nav-links,
.utility-actions,
.meta-row,
.chips,
.stack,
.hero-actions,
.home-tag-cloud {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.topline-row { justify-content: space-between; padding: 7px 0; }
.topline-meta span,
.topline-links a {
  color: var(--muted);
  font-size: 0.84rem;
  font-weight: 800;
}
.topline-meta span:not(:last-child)::after {
  content: '';
  display: inline-block;
  width: 1px;
  height: 12px;
  margin-left: 12px;
  background: var(--line);
  vertical-align: middle;
}

.nav-row { justify-content: space-between; padding: 10px 0; }
.brand { display: flex; align-items: center; gap: 13px; min-width: 0; }
.brand-mark {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #ffffff;
  font-weight: 800;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, #075fc6 0%, #06111f 100%);
  box-shadow: none;
}
:root[data-theme="dark"] .brand-mark {
  color: #060606;
  background: linear-gradient(135deg, #f2d69d 0%, #a67b34 100%);
  box-shadow: none;
}
.brand-copy { min-width: 0; }
.brand-copy strong { display: block; color: var(--accent); font-size: 1.18rem; font-weight: 800; }
.brand-copy span { display: block; color: var(--muted); font-size: 0.78rem; }

.nav-strip { border-top: 1px solid var(--line); background: var(--surface); }
.nav-links-primary { gap: 20px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.nav-links-primary::-webkit-scrollbar { display: none; }
.nav-link,
.menu-summary {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
}
.nav-link.active,
.nav-link:hover,
.menu-group[open] .menu-summary {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.menu-group { position: relative; }
.menu-summary { gap: 8px; list-style: none; cursor: pointer; }
.menu-summary::-webkit-details-marker { display: none; }
.menu-summary::after {
  content: '';
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg) translateY(-2px);
}
.menu-popover {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  min-width: 230px;
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
  z-index: 30;
}
.menu-link,
.drawer-link {
  display: flex;
  align-items: center;
  padding: 9px 10px;
  border-radius: 6px;
  color: var(--text);
  font-weight: 800;
}
.menu-link:hover,
.menu-link.active,
.drawer-link:hover,
.drawer-link.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.btn,
button,
input,
textarea,
select { font: inherit; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 7px 10px;
  background: var(--surface);
  color: var(--text);
  font-weight: 700;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}
.btn:hover { transform: translateY(-1px); border-color: var(--line-strong); box-shadow: var(--shadow-soft); }
.btn-primary { background: var(--surface-contrast); color: var(--surface); border-color: var(--surface-contrast); }
:root[data-theme="dark"] .btn-primary { color: #050505; background: var(--accent); border-color: var(--accent); }
.btn-primary:hover { background: var(--accent); border-color: var(--accent); color: #ffffff; }
:root[data-theme="dark"] .btn-primary:hover { color: #050505; background: var(--accent-strong); }
.btn-soft { background: var(--accent-soft); color: var(--accent-strong); border-color: transparent; }
.btn-danger { color: var(--danger); background: rgba(199, 57, 57, 0.1); }

.main-flow { padding: 22px 0 60px; }
.hero { padding: 0 0 24px; }
.hero-panel,
.card,
.panel,
.aside-card,
.table-wrap,
.hero-card,
.metric,
.lead-story,
.topic-panel,
.feature-wide {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow);
}
:root[data-theme="dark"] .hero-panel,
:root[data-theme="dark"] .card,
:root[data-theme="dark"] .panel,
:root[data-theme="dark"] .aside-card,
:root[data-theme="dark"] .table-wrap,
:root[data-theme="dark"] .hero-card,
:root[data-theme="dark"] .metric,
:root[data-theme="dark"] .lead-story,
:root[data-theme="dark"] .topic-panel,
:root[data-theme="dark"] .feature-wide {
  background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012)), var(--surface);
}
.hero-panel {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  padding: clamp(26px, 4vw, 46px);
}
.hero-panel::after {
  content: '';
  position: absolute;
  inset: auto -15% -35% auto;
  width: min(520px, 70vw);
  height: min(520px, 70vw);
  border-radius: 6px;
  background: var(--accent-soft);
  filter: blur(14px);
  opacity: 0.55;
  pointer-events: none;
}
.hero-grid,
.two-col,
.article-layout,
.footer-grid,
.dashboard-grid,
.stats-grid,
.profile-grid,
.lead-grid,
.section-columns,
.news-grid,
.feature-grid,
.market-grid,
.form-grid {
  display: grid;
  gap: 18px;
}
.hero-grid { grid-template-columns: 1.25fr 0.95fr; align-items: center; }
.lead-grid { grid-template-columns: minmax(0, 1.32fr) minmax(320px, 0.88fr); align-items: start; }
.feature-grid { grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr); }
.article-layout { grid-template-columns: minmax(0, 1fr) 330px; align-items: start; gap: 22px; }
.news-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.section-columns { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.stats-grid,
.dashboard-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.footer-grid { grid-template-columns: 1.1fr 0.9fr 0.8fr 0.8fr; }
.profile-grid { grid-template-columns: 0.75fr 1.25fr; }
.form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form-grid .full { grid-column: 1 / -1; }
.market-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.hero h1,
.lead-story h1 { font-size: clamp(1.85rem, 4.2vw, 3.2rem); max-width: 14ch; }
.article-meta h1 { font-size: clamp(1.75rem, 3.2vw, 2.7rem); max-width: 19ch; }
.section-head h2 { font-size: clamp(1.25rem, 2.2vw, 1.85rem); }
.hero-copy p,
.lede,
.page-intro p,
.lead-story p,
.headline-item p,
.topic-feature p,
.article-card p,
.card p {
  color: var(--muted);
  line-height: 1.62;
}

.section { margin-top: 24px; }
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.section-head h2 { position: relative; padding-left: 16px; }
.section-head h2::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.18em;
  bottom: 0.18em;
  width: 4px;
  border-radius: 6px;
  background: var(--accent);
}
.page-intro { margin-bottom: 22px; }
.page-intro h1 { font-size: clamp(1.7rem, 3.6vw, 2.75rem); }

.eyebrow,
.kicker,
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 8px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.kicker { margin-bottom: 12px; }
.tone-success { color: var(--success); }
.tone-warning { color: var(--warning); }
.tone-danger { color: var(--danger); }
.chip.tone-success,
.chip.tone-warning,
.chip.tone-danger { background: var(--surface-muted); }

.card,
.panel,
.aside-card,
.table-wrap,
.hero-card,
.metric,
.topic-panel { padding: 16px; }
.metric strong { display: block; margin-bottom: 4px; font-size: 1.45rem; letter-spacing: -0.02em; }
.metric span,
.muted,
.small,
.meta-row { color: var(--muted); }
.small { font-size: 0.9rem; }
.meta-row { gap: 14px; font-size: 0.9rem; }
.stack { align-items: stretch; }

.lead-story,
.article-card,
.feature-wide { overflow: hidden; padding: 0; }
.lead-story-image,
.article-card img,
.lead-image,
.topic-feature img {
  width: 100%;
  object-fit: cover;
  border-bottom: 1px solid var(--line);
}
.lead-story-image { aspect-ratio: 16 / 9; }
.article-card img,
.lead-image,
.topic-feature img { aspect-ratio: 16 / 10; }
.lead-story-content,
.article-card-body,
.feature-wide .topic-feature { padding: 20px; }
.article-card { display: flex; flex-direction: column; min-height: 100%; }
.article-card-body { display: flex; flex-direction: column; min-height: 220px; }
.article-card h3 { font-size: 1.12rem; line-height: 1.35; }
.topic-feature h3 { font-size: 1.16rem; line-height: 1.35; }
.card-media { display: block; }
.lead-image { border-radius: var(--radius-md); border: 1px solid var(--line); margin-bottom: 18px; }

.article-body {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow);
  font-size: 1rem;
  line-height: 1.72;
}
.article-body h2 { margin-top: 2rem; font-size: 1.62rem; }
.article-body ul { padding-left: 1.15rem; color: var(--muted); }
.article-meta { margin-bottom: 20px; }
.breadcrumbs { display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 0.92rem; margin-bottom: 16px; }
.breadcrumbs a:hover { color: var(--accent); }
.aside-card h3 { font-size: 1.14rem; }

.panel-head {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
  font-size: 1.1rem;
  font-weight: 800;
}
.headline-item,
.text-feed-item,
.list-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.headline-item:last-child,
.text-feed-item:last-child,
.list-item:last-child { padding-bottom: 0; border-bottom: 0; }
.headline-item h3,
.text-feed-item h3 { font-size: 1.13rem; line-height: 1.38; margin-bottom: 6px; }
.list-clean,
.inline-list,
.home-sidebar { display: grid; gap: 14px; }
.market-tile {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}
.market-tile strong { display: block; margin-bottom: 4px; font-size: 1.1rem; }
.tag-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
}
.tag-link:hover { color: var(--accent); border-color: var(--line-strong); }

label { display: block; margin-bottom: 8px; font-size: 0.9rem; font-weight: 900; }
input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--field-bg);
  color: var(--text);
  padding: 10px 12px;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}
textarea { min-height: 118px; resize: vertical; }
input::placeholder,
textarea::placeholder { color: color-mix(in srgb, var(--muted) 72%, transparent); }
input:focus,
textarea:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
select option { color: var(--text); background: var(--surface); }

.notice,
.helper {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
}
.notice { background: var(--accent-soft); color: var(--accent-strong); }
.helper { background: var(--surface-muted); color: var(--muted); }

.table-wrap { overflow-x: auto; padding: 8px 14px; }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th,
td {
  border-bottom: 1px solid var(--line);
  padding: 10px 8px;
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
tbody tr:hover { background: var(--surface-muted); }
:root[data-theme="dark"] tbody tr:hover { background: rgba(255,255,255,0.035); }

.footer {
  margin-top: 44px;
  padding: 36px 0 54px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.footer h3 { font-size: 1.05rem; margin-bottom: 10px; }
.footer p,
.footer a { color: var(--muted); line-height: 1.75; }
.footer a:hover { color: var(--accent); }

.toast-root {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: grid;
  gap: 10px;
  z-index: 120;
}
.toast {
  min-width: 260px;
  max-width: 360px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-strong);
  box-shadow: var(--shadow);
  padding: 11px 12px;
  color: var(--text);
  font-weight: 750;
}
.center { text-align: center; }
.empty,
.empty-state { padding: 42px 24px; text-align: center; color: var(--muted); }
.empty-state h3 { margin-bottom: 10px; color: var(--text); font-size: 1.45rem; }
.empty-state p { max-width: 640px; margin: 0 auto 16px; }

.mobile-bottom-nav {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: none;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--header-bg);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
  z-index: 90;
}
.mobile-nav-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 50px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
  text-align: center;
}
.mobile-nav-link.active,
.mobile-nav-link:hover { background: var(--accent-soft); color: var(--accent-strong); }
.nav-icon { width: 20px; height: 20px; display: block; }
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
  z-index: 88;
}
.drawer-backdrop.is-open { opacity: 1; pointer-events: auto; }
.mobile-drawer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 76vh;
  overflow: auto;
  padding: 18px 18px calc(20px + env(safe-area-inset-bottom));
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow);
  transform: translateY(102%);
  transition: transform 220ms ease;
  z-index: 89;
}
.mobile-drawer.is-open { transform: translateY(0); }
.drawer-handle { width: 54px; height: 5px; margin: 0 auto 16px; border-radius: 999px; background: var(--line-strong); }
.drawer-group { margin-bottom: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-muted); }
.drawer-group summary { list-style: none; cursor: pointer; padding: 11px 12px; font-weight: 700; }
.drawer-group summary::-webkit-details-marker { display: none; }
.drawer-links { display: grid; gap: 6px; padding: 0 12px 12px; }


.brand-logo {
  width: 38px;
  height: 38px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 7px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-muted);
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 700;
}
.status-pill.tone-success { color: var(--success); }
.status-pill.tone-warning { color: var(--warning); }
.status-pill.tone-danger { color: var(--danger); }
.status-pill.tone-neutral { color: var(--muted); }
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-muted);
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}
.check-row input { width: auto; margin-top: 3px; }
.check-row a { color: var(--accent-strong); text-decoration: underline; text-underline-offset: 3px; }
.logo-preview {
  width: 68px;
  height: 44px;
  object-fit: contain;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-muted);
  padding: 6px;
}
.legal-document {
  display: grid;
  gap: 14px;
  max-width: 900px;
}
.legal-document .card h2 { font-size: 1.18rem; }
.legal-document .card ul { margin: 0; padding-left: 1.15rem; color: var(--muted); line-height: 1.62; }
.compact-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

@media (max-width: 1100px) {
  .hero-grid,
  .lead-grid,
  .feature-grid,
  .article-layout,
  .section-columns,
  .footer-grid,
  .stats-grid,
  .dashboard-grid,
  .profile-grid { grid-template-columns: 1fr; }
}

@media (max-width: 860px) {
  .topline-row,
  .nav-row { flex-direction: column; align-items: stretch; }
  .utility-actions { justify-content: flex-start; }
  .news-grid,
  .section-columns,
  .form-grid { grid-template-columns: 1fr 1fr; }
  .menu-popover { position: static; min-width: 0; margin-bottom: 10px; box-shadow: none; }
  .nav-links-primary { flex-wrap: wrap; overflow: visible; }
}

@media (max-width: 640px) {
  .site-shell { width: min(100%, calc(100% - 20px)); }
  .news-grid,
  .section-columns,
  .form-grid,
  .stats-grid,
  .dashboard-grid,
  .market-grid { grid-template-columns: 1fr; }
  .brand-copy strong { font-size: 1.24rem; }
  .article-meta h1,
  .lead-story h1,
  .hero h1 { max-width: 100%; }
  .btn { width: auto; }
  body { padding-bottom: 96px; }
  .site-topline,
  .nav-strip { display: none; }
  .utility-actions .btn:nth-child(n + 3) { display: none; }
  .mobile-bottom-nav { display: grid; }
}
/* Rich post composer and article media */
.form-helper,
.input-hint {
  display: block;
  margin-top: 6px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
}
.composer-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.preview-panel {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}
.preview-panel:empty { display: none; }
.preview-card,
.resource-card,
.social-card {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.preview-card strong,
.resource-card span,
.social-card strong { font-size: 0.9rem; }
.preview-card small,
.resource-card small,
.social-card small { color: var(--muted); overflow-wrap: anywhere; }
.article-resource-block { margin-top: 18px; }
.compact-head { margin-bottom: 12px; padding-bottom: 8px; }
.compact-head h2 { font-size: 1.2rem; }
.resource-grid,
.social-grid,
.video-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.media-tile {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.media-tile img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}
.media-tile figcaption,
.video-card p {
  margin: 0;
  padding: 9px 10px;
  color: var(--muted);
  font-size: 0.86rem;
}
.video-card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.video-card iframe,
.video-card video {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  display: block;
  background: #000;
}
.social-card {
  border-left: 3px solid var(--accent);
}
.platform-telegram { border-left-color: #229ed9; }
.platform-instagram { border-left-color: #d62976; }
.platform-facebook { border-left-color: #1877f2; }
.platform-likee { border-left-color: #ff2d55; }
.platform-youtube { border-left-color: #ff0033; }
.reader-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 760px) {
  .resource-grid,
  .social-grid,
  .video-grid,
  .media-grid { grid-template-columns: 1fr; }
  .reader-actions .btn { flex: 1 1 140px; }
}

`;

const siteJs = `
(() => {
  const state = {
    config: null,
    session: null,
    alertCursor: Number(localStorage.getItem('hallaym:last-alert') || Date.now())
  };

  function request(path, options = {}) {
    const settings = { credentials: 'same-origin', ...options };
    if (settings.body && typeof settings.body !== 'string') {
      settings.headers = { 'Content-Type': 'application/json', ...(settings.headers || {}) };
      settings.body = JSON.stringify(settings.body);
    }
    return fetch(path, settings).then(async (res) => {
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const payload = isJson ? await res.json() : await res.text();
      if (!res.ok) {
        const message = isJson && payload && payload.error ? payload.error : 'Request failed';
        throw new Error(message);
      }
      return payload;
    });
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('uz-UZ').format(Number(value || 0));
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('hallaym:theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim';
    });
  }

  function initTheme() {
    const stored = localStorage.getItem('hallaym:theme');
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(stored || preferred);
  }

  function ensureToastRoot() {
    let root = document.querySelector('.toast-root');
    if (!root) {
      root = document.createElement('div');
      root.className = 'toast-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function toast(message) {
    const root = ensureToastRoot();
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    root.appendChild(item);
    window.setTimeout(() => item.remove(), 3600);
  }

  function logout() {
    return request('/api/auth/logout', { method: 'POST' }).then(() => {
      window.location.href = '/';
    });
  }

  function renderHeader(config, user) {
    const path = window.location.pathname;
    const isActive = (href) => path === href ? 'active' : '';
    const accountLink = user
      ? '<a class="btn btn-soft" href="' + (user.role === 'admin' ? '/admin' : (user.role === 'author' ? '/writer' : '/search')) + '">Kabinet</a>'
      : '<a class="btn btn-soft" href="/login">Kirish</a>';
    const writerLink = user && (user.role === 'author' || user.role === 'admin')
      ? '<a class="btn" href="/writer">Muallif xonasi</a>'
      : '<a class="btn" href="/apply">Muallif bo\\'lish</a>';
    const categoryLinks = (config.categories || []).map((item) =>
      '<a class="menu-link ' + (isActive('/category/' + item.slug) ? 'active' : '') + '" href="/category/' + item.slug + '">' + item.label + '</a>'
    ).join('');
    const pageLinks = [
      { href: '/authors', label: 'Mualliflar' },
      { href: '/about', label: 'Rasmiylik' },
      { href: '/contact', label: 'Aloqa' },
      { href: '/privacy', label: 'Maxfiylik' },
      { href: '/terms', label: 'Shartlar' }
    ].map((item) =>
      '<a class="menu-link ' + (isActive(item.href) ? 'active' : '') + '" href="' + item.href + '">' + item.label + '</a>'
    ).join('');
    const feedLinks = [
      { href: '/rss.xml', label: 'Yangiliklar oqimi' },
      { href: '/sitemap.xml', label: 'Sayt xaritasi' },
      { href: '/news-sitemap.xml', label: 'Nashr xaritasi' }
    ].map((item) =>
      '<a class="menu-link" href="' + item.href + '">' + item.label + '</a>'
    ).join('');
    return [
      '<header class="site-header">',
      '<div class="site-topline">',
      '<div class="site-shell topline-row">',
      '<div class="topline-meta">',
      '<span>Hallaym Media Group</span>',
      '<span>Rasmiy nashr</span>',
      '<span>Mobilga qulay</span>',
      '<span>Qidiruvga tayyor</span>',
      '</div>',
      '<div class="topline-links">',
      '<a href="/rss.xml">Oqim</a>',
      '<a href="/news-sitemap.xml">Nashr xaritasi</a>',
      '<a href="/contact">Aloqa</a>',
      '</div>',
      '</div>',
      '</div>',
      '<div class="site-shell nav-row">',
      '<a class="brand" href="/">',
      (config.brand.logoUrl ? '<img class="brand-logo" src="' + config.brand.logoUrl + '" alt="' + config.brand.siteName + ' logo" />' : '<span class="brand-mark">HN</span>'),
      '<span class="brand-copy"><strong>' + config.brand.siteName + '</strong><span>Tezkor yangiliklar va tahririyat signallari</span></span>',
      '</a>',
      '<div class="utility-actions">',
      '<button type="button" class="btn" data-theme-toggle>Tungi rejim</button>',
      '<button type="button" class="btn" data-notify-toggle>Bildirishnomalar</button>',
      '<a class="btn" href="/search">Qidiruv</a>',
      writerLink,
      accountLink,
      user ? '<button type="button" class="btn" data-logout>Chiqish</button>' : '<a class="btn btn-primary" href="/register">Ro\\'yxatdan o\\'tish</a>',
      '</div>',
      '</div>',
      '<div class="nav-strip">',
      '<div class="site-shell">',
      '<nav class="nav-links nav-links-primary">',
      '<a class="nav-link ' + isActive('/') + '" href="/">Bosh sahifa</a>',
      '<details class="menu-group"><summary class="menu-summary">Kategoriyalar</summary><div class="menu-popover">' + categoryLinks + '</div></details>',
      '<details class="menu-group"><summary class="menu-summary">Sahifalar</summary><div class="menu-popover">' + pageLinks + '</div></details>',
      '<details class="menu-group"><summary class="menu-summary">Oqimlar</summary><div class="menu-popover">' + feedLinks + '</div></details>',
      '</nav>',
      '</div>',
      '</div>',
      '</header>'
    ].join('');
  }

  function renderFooter(config) {
    const footerCategories = (config.categories || []).map((item) =>
      '<p><a href="/category/' + item.slug + '">' + item.label + '</a></p>'
    ).join('');
    return [
      '<footer class="footer">',
      '<div class="site-shell footer-grid">',
      '<div>',
      '<h3>' + config.brand.siteName + '</h3>',
      '<p>' + config.brand.footerAbout + '</p>',
      '<p class="small">Owner: ' + config.brand.ownerName + '</p>',
      '</div>',
      '<div>',
      '<h3>Bo\\'limlar</h3>',
      footerCategories,
      '</div>',
      '<div>',
      '<h3>Oqimlar</h3>',
      '<p><a href="/rss.xml">Yangiliklar oqimi</a></p>',
      '<p><a href="/sitemap.xml">Sayt xaritasi</a></p>',
      '<p><a href="/news-sitemap.xml">Nashr xaritasi</a></p>',
      '<p><a href="/about">Tahrir siyosati</a></p>',
      '<p><a href="/privacy.pdf">Maxfiylik PDF</a></p>',
      '<p><a href="/terms.pdf">Shartlar PDF</a></p>',
      '</div>',
      '<div>',
      '<h3>Aloqa</h3>',
      '<p>' + config.brand.newsroomEmail + '</p>',
      '<p>' + config.brand.phone + '</p>',
      '<p>' + config.brand.address + '</p>',
      '</div>',
      '</div>',
      '</footer>'
    ].join('');
  }

  function icon(name) {
    const icons = {
      home: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/></svg>',
      search: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
      layers: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 4.5-9 4.5L3 7.5 12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/></svg>',
      bell: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0v3.2c0 .8.2 1.5.6 2.2l1 1.8H4.4l1-1.8c.4-.7.6-1.4.6-2.2V9"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
      menu: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>',
      user: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>',
      rss: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19a1.5 1.5 0 1 0 0-.01"/><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 5a15 15 0 0 1 15 15"/></svg>'
    };
    return icons[name] || icons.menu;
  }

  function renderMobileNav(config, user) {
    const path = window.location.pathname;
    const isActive = (matcher) => typeof matcher === 'function' ? matcher(path) : path === matcher;
    const accountHref = user ? (user.role === 'admin' ? '/admin' : user.role === 'author' ? '/writer' : '/search') : '/login';
    const accountLabel = user ? (user.role === 'admin' ? 'Boshqaruv' : user.role === 'author' ? 'Muallif' : 'Kabinet') : 'Kirish';
    const categories = (config.categories || []).map((item) =>
      '<a class="drawer-link ' + (path === '/category/' + item.slug ? 'active' : '') + '" href="/category/' + item.slug + '">' + item.label + '</a>'
    ).join('');
    const pages = [
      { href: '/authors', label: 'Mualliflar' },
      { href: '/about', label: 'Rasmiylik' },
      { href: '/contact', label: 'Aloqa' },
      { href: '/privacy', label: 'Maxfiylik siyosati' },
      { href: '/terms', label: 'Foydalanish shartlari' }
    ].map((item) =>
      '<a class="drawer-link ' + (path === item.href ? 'active' : '') + '" href="' + item.href + '">' + item.label + '</a>'
    ).join('');
    const feeds = [
      { href: '/rss.xml', label: 'Yangiliklar oqimi' },
      { href: '/sitemap.xml', label: 'Sayt xaritasi' },
      { href: '/news-sitemap.xml', label: 'Nashr xaritasi' }
    ].map((item) => '<a class="drawer-link" href="' + item.href + '">' + item.label + '</a>').join('');
    return [
      '<div data-mobile-shell>',
      '<div class="drawer-backdrop" data-drawer-backdrop></div>',
      '<div class="mobile-drawer" data-mobile-drawer>',
      '<div class="drawer-handle"></div>',
      '<details class="drawer-group" data-drawer-group="categories"><summary>Kategoriyalar</summary><div class="drawer-links">' + categories + '</div></details>',
      '<details class="drawer-group"><summary>Sahifalar</summary><div class="drawer-links">' + pages + '</div></details>',
      '<details class="drawer-group"><summary>Oqimlar</summary><div class="drawer-links">' + feeds + '</div></details>',
      '<details class="drawer-group"><summary>Kabinet</summary><div class="drawer-links"><a class="drawer-link" href="' + accountHref + '">Kabinet</a><a class="drawer-link" href="/apply">Muallif bo\\'lish</a></div></details>',
      '</div>',
      '<nav class="mobile-bottom-nav">',
      '<a class="mobile-nav-link ' + (isActive('/') ? 'active' : '') + '" href="/">' + icon('home') + '<span>Bosh</span></a>',
      '<a class="mobile-nav-link ' + (isActive('/search') ? 'active' : '') + '" href="/search">' + icon('search') + '<span>Qidiruv</span></a>',
      '<button class="mobile-nav-link" type="button" data-open-group="categories">' + icon('layers') + '<span>Bo‘lim</span></button>',
      '<a class="mobile-nav-link ' + ((isActive('/admin') || isActive('/writer') || isActive('/login')) ? 'active' : '') + '" href="' + accountHref + '">' + icon('user') + '<span>' + accountLabel + '</span></a>',
      '<button class="mobile-nav-link" type="button" data-mobile-menu>' + icon('menu') + '<span>Menyu</span></button>',
      '</nav>',
      '</div>'
    ].join('');
  }

  function bindMobileNav() {
    const shell = document.querySelector('[data-mobile-shell]');
    if (!shell) return;
    const backdrop = shell.querySelector('[data-drawer-backdrop]');
    const drawer = shell.querySelector('[data-mobile-drawer]');
    const openDrawer = (groupName) => {
      drawer.classList.add('is-open');
      backdrop.classList.add('is-open');
      if (groupName) {
        const details = drawer.querySelector('[data-drawer-group="' + groupName + '"]');
        if (details) details.open = true;
      }
    };
    const closeDrawer = () => {
      drawer.classList.remove('is-open');
      backdrop.classList.remove('is-open');
    };
    shell.querySelectorAll('[data-mobile-menu]').forEach((button) => {
      button.onclick = () => openDrawer();
    });
    shell.querySelectorAll('[data-open-group]').forEach((button) => {
      button.onclick = () => openDrawer(button.dataset.openGroup);
    });
    shell.querySelectorAll('[data-mobile-notify]').forEach((button) => {
      button.onclick = async () => {
        try {
          await enableBildirishnomalar();
        } catch (error) {
          toast(error.message);
        }
      };
    });
    if (backdrop) backdrop.onclick = closeDrawer;
    drawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeDrawer);
    });
  }

  function mountMobileNav(config, user) {
    const existing = document.querySelector('[data-mobile-shell]');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', renderMobileNav(config, user));
    bindMobileNav();
  }

  function bindChrome() {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.onclick = () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      };
    });

    document.querySelectorAll('[data-notify-toggle]').forEach((button) => {
      button.onclick = async () => {
        try {
          await enableBildirishnomalar();
        } catch (error) {
          toast(error.message);
        }
      };
    });

    document.querySelectorAll('[data-logout]').forEach((button) => {
      button.onclick = async () => {
        try {
          await logout();
        } catch (error) {
          toast(error.message);
        }
      };
    });
  }

  function hydrateChrome() {
    return Promise.all([request('/api/config'), request('/api/session')])
      .then(([config, session]) => {
        state.config = config;
        state.session = session;
        document.querySelectorAll('[data-dynamic-header]').forEach((node) => {
          node.innerHTML = renderHeader(config, session.user);
        });
        document.querySelectorAll('[data-dynamic-footer]').forEach((node) => {
          node.innerHTML = renderFooter(config);
        });
        bindChrome();
        mountMobileNav(config, session.user);
        return { config, session };
      })
      .catch(() => {
        bindChrome();
      });
  }

  async function enableBildirishnomalar() {
    if (!('Notification' in window)) {
      throw new Error('Brauzer notifications qo\\'llab-quvvatlanmaydi.');
    }
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/service-worker.js');
      } catch (error) {
        // ignore
      }
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Bildirishnomalar uchun ruxsat berilmadi.');
    }
    await request('/api/subscribe', { method: 'POST', body: { type: 'browser', target: 'browser' } });
    localStorage.setItem('hallaym:last-alert', String(Date.now()));
    state.alertCursor = Date.now();
    const registration = await navigator.serviceWorker.ready;
    if (registration.showNotification) {
      await registration.showNotification('Hallaym Newsroom', {
        body: 'Yangiliklar bildirishnomalari yoqildi.',
        icon: '/media/logo.svg',
        badge: '/media/logo.svg',
        data: { url: '/' }
      });
    }
    toast('Bildirishnomalar yoqildi.');
  }

  async function pollAlerts() {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    const payload = await request('/api/alerts?since=' + state.alertCursor);
    if (!payload.items || !payload.items.length) {
      return;
    }
    state.alertCursor = payload.latest;
    localStorage.setItem('hallaym:last-alert', String(payload.latest));
    const registration = await navigator.serviceWorker.ready;
    for (const item of payload.items) {
      if (registration.showNotification) {
        await registration.showNotification(item.title, {
          body: item.excerpt,
          icon: item.imageUrl,
          badge: '/media/logo.svg',
          data: { url: item.url }
        });
      }
    }
  }

  function initBildirishnomalar() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
    window.setInterval(() => {
      pollAlerts().catch(() => {});
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    hydrateChrome();
    initBildirishnomalar();
  });

  window.Hallaym = {
    request,
    formatDate,
    formatNumber,
    toast,
    session: () => state.session,
    config: () => state.config,
    hydrateChrome,
    enableBildirishnomalar
  };
})();

`;

function renderServerHeader(activePath, user) {
  const isActive = (href) => (activePath === href ? 'active' : '');
  const dashboardLink =
    user && user.role === 'admin'
      ? '<a class="btn btn-soft" href="/admin">Boshqaruv</a>'
      : user && user.role === 'author'
        ? '<a class="btn btn-soft" href="/writer">Muallif xonasi</a>'
        : '<a class="btn btn-soft" href="/apply">Muallif bo\'lish</a>';
  const authBlock = user
    ? `<button type="button" class="btn" data-logout>Chiqish</button>`
    : `<a class="btn btn-primary" href="/register">Ro'yxatdan o'tish</a>`;
  const categoryLinks = categoryCatalog
    .map(
      (category) =>
        `<a class="menu-link ${isActive(`/category/${category.slug}`) ? 'active' : ''}" href="/category/${category.slug}">${escapeHtml(category.label)}</a>`,
    )
    .join('');
  const pageLinks = [
    { href: '/authors', label: 'Mualliflar' },
    { href: '/about', label: 'Rasmiylik' },
    { href: '/contact', label: 'Aloqa' },
    { href: '/privacy', label: 'Maxfiylik' },
    { href: '/terms', label: 'Shartlar' },
  ]
    .map((item) => `<a class="menu-link ${isActive(item.href) ? 'active' : ''}" href="${item.href}">${item.label}</a>`)
    .join('');
  const feedLinks = [
    { href: '/rss.xml', label: 'Yangiliklar oqimi' },
    { href: '/sitemap.xml', label: 'Sayt xaritasi' },
    { href: '/news-sitemap.xml', label: 'Nashr xaritasi' },
  ]
    .map((item) => `<a class="menu-link" href="${item.href}">${item.label}</a>`)
    .join('');
  return `
    <header class="site-header">
      <div class="site-topline">
        <div class="site-shell topline-row">
          <div class="topline-meta">
            <span>Hallaym Media Group</span>
            <span>Rasmiy nashr</span>
            <span>Mobilga qulay</span>
            <span>Qidiruvga tayyor</span>
          </div>
          <div class="topline-links">
            <a href="/rss.xml">Oqim</a>
            <a href="/news-sitemap.xml">Nashr xaritasi</a>
            <a href="/contact">Aloqa</a>
          </div>
        </div>
      </div>
      <div class="site-shell nav-row">
        <a class="brand" href="/">
          ${store.settings.brand.logoUrl ? `<img class="brand-logo" src="${escapeHtml(store.settings.brand.logoUrl)}" alt="${escapeHtml(store.settings.brand.siteName)} logo" />` : `<span class="brand-mark">HN</span>`}
          <span class="brand-copy">
            <strong>${escapeHtml(store.settings.brand.siteName)}</strong>
            <span>Tezkor yangiliklar va tahririyat signallari</span>
          </span>
        </a>
        <div class="utility-actions">
          <button type="button" class="btn" data-theme-toggle>Tungi rejim</button>
          <button type="button" class="btn" data-notify-toggle>Bildirishnomalar</button>
          <a class="btn" href="/search">Qidiruv</a>
          ${dashboardLink}
          ${user ? `<a class="btn" href="${user.role === 'admin' ? '/admin' : user.role === 'author' ? '/writer' : '/search'}">Kabinet</a>` : `<a class="btn" href="/login">Kirish</a>`}
          ${authBlock}
        </div>
      </div>
      <div class="nav-strip">
        <div class="site-shell">
          <nav class="nav-links nav-links-primary">
            <a class="nav-link ${isActive('/')}" href="/">Bosh sahifa</a>
            <details class="menu-group">
              <summary class="menu-summary">Kategoriyalar</summary>
              <div class="menu-popover">${categoryLinks}</div>
            </details>
            <details class="menu-group">
              <summary class="menu-summary">Sahifalar</summary>
              <div class="menu-popover">${pageLinks}</div>
            </details>
            <details class="menu-group">
              <summary class="menu-summary">Oqimlar</summary>
              <div class="menu-popover">${feedLinks}</div>
            </details>
          </nav>
        </div>
      </div>
    </header>
  `;
}

function renderServerFooter() {
  const footerCategories = categoryCatalog
    .map((category) => `<p><a href="/category/${category.slug}">${escapeHtml(category.label)}</a></p>`)
    .join('');
  return `
    <footer class="footer">
      <div class="site-shell footer-grid">
        <div>
          <h3>${escapeHtml(store.settings.brand.siteName)}</h3>
          <p>${escapeHtml(store.settings.brand.footerAbout)}</p>
          <p class="small">Owner: ${escapeHtml(store.settings.brand.ownerName)}</p>
        </div>
        <div>
          <h3>Bo'limlar</h3>
          ${footerCategories}
        </div>
        <div>
          <h3>Oqimlar</h3>
          <p><a href="/rss.xml">Yangiliklar oqimi</a></p>
          <p><a href="/sitemap.xml">Sayt xaritasi</a></p>
          <p><a href="/news-sitemap.xml">Nashr xaritasi</a></p>
          <p><a href="/about">Tahrir siyosati</a></p>
          <p><a href="/privacy.pdf">Maxfiylik PDF</a></p>
          <p><a href="/terms.pdf">Shartlar PDF</a></p>
        </div>
        <div>
          <h3>Aloqa</h3>
          <p>${escapeHtml(store.settings.brand.newsroomEmail)}</p>
          <p>${escapeHtml(store.settings.brand.phone)}</p>
          <p>${escapeHtml(store.settings.brand.address)}</p>
        </div>
      </div>
    </footer>
  `;
}

function renderLayout({ title, description, canonical, image, activePath = '/', content, structuredData = [], robots = 'index,follow', user }) {
  return `<!DOCTYPE html>
  <html lang="uz">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content="${escapeHtml(description)}" />
      <meta name="robots" content="${escapeHtml(robots)}" />
      <meta name="theme-color" content="#0a65c7" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content="${escapeHtml(title)}" />
      <meta property="og:description" content="${escapeHtml(description)}" />
      <meta property="og:url" content="${escapeHtml(canonical)}" />
      <meta property="og:image" content="${escapeHtml(image)}" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${escapeHtml(title)}" />
      <meta name="twitter:description" content="${escapeHtml(description)}" />
      <meta name="twitter:image" content="${escapeHtml(image)}" />
      <link rel="canonical" href="${escapeHtml(canonical)}" />
      <link rel="alternate" type="application/rss+xml" title="${escapeHtml(store.settings.brand.siteName)} RSS" href="${store.settings.siteUrl}/rss.xml" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="stylesheet" href="/assets/site.css" />
      <title>${escapeHtml(title)}</title>
      <script>try{const theme=localStorage.getItem('hallaym:theme');if(theme){document.documentElement.dataset.theme=theme;}}catch(e){}</script>
      ${renderStructuredData(structuredData)}
    </head>
    <body>
      ${renderServerHeader(activePath, user)}
      <div class="site-shell main-flow">${content}</div>
      ${renderServerFooter()}
      <script src="/assets/site.js" defer></script>
    </body>
  </html>`;
}

function renderArticleCard(article) {
  const author = getUserById(article.authorId);
  return `
    <article class="card article-card">
      <a class="card-media" href="/news/${article.slug}">
        <img src="${articleImageUrl(article)}" alt="${escapeHtml(article.title)}" />
      </a>
      <div class="article-card-body">
        <span class="kicker">${escapeHtml(article.categoryLabel)}</span>
        <h3><a href="/news/${article.slug}">${escapeHtml(article.title)}</a></h3>
        <p>${escapeHtml(article.excerpt)}</p>
        <div class="meta-row">
          <span>${escapeHtml(author?.name || 'Hallaym Team')}</span>
          <span>${escapeHtml(formatDate(article.publishedAt))}</span>
          <span>${article.readingMinutes} min o'qish</span>
        </div>
      </div>
    </article>
  `;
}

function renderReadinessPill(status) {
  const badge = readStatusBadge(status);
  return `<span class="chip tone-${badge.tone}">${badge.label}</span>`;
}

function renderEmptyState(title, body, actionHref = '/writer', actionLabel = 'Birinchi postni yarating') {
  return `
    <div class="card empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      <a class="btn btn-primary" href="${actionHref}">${escapeHtml(actionLabel)}</a>
    </div>
  `;
}

function renderHeadlineItem(article, showExcerpt = false) {
  return `
    <article class="headline-item">
      <span class="small">${escapeHtml(article.categoryLabel)} • ${formatDate(article.publishedAt)}</span>
      <h3><a href="/news/${article.slug}">${escapeHtml(article.title)}</a></h3>
      ${showExcerpt ? `<p>${escapeHtml(article.excerpt)}</p>` : ''}
    </article>
  `;
}

function renderTopicPanel(title, items, slug) {
  if (!items.length) {
    return `
      <section class="card topic-panel">
        <div class="panel-head">${escapeHtml(title)}</div>
        <div class="empty-state">
          <h3>Hozircha material yo'q</h3>
          <p>Bu bo'limda ilk maqola joylangach, shu yerda ko'rinadi.</p>
          <a class="btn" href="/category/${slug}">Bo'lim sahifasi</a>
        </div>
      </section>
    `;
  }
  const [primary, ...rest] = items;
  return `
    <section class="card topic-panel">
      <div class="panel-head">${escapeHtml(title)}</div>
      <article class="topic-feature">
        <a href="/news/${primary.slug}">
          <img src="${articleImageUrl(primary)}" alt="${escapeHtml(primary.title)}" />
        </a>
        <span class="kicker">${escapeHtml(primary.categoryLabel)}</span>
        <h3><a href="/news/${primary.slug}">${escapeHtml(primary.title)}</a></h3>
        <p>${escapeHtml(primary.excerpt)}</p>
      </article>
      <div class="inline-list">
        ${rest.slice(0, 3).map((article) => renderHeadlineItem(article, false)).join('')}
      </div>
      <div style="margin-top:14px">
        <a class="btn" href="/category/${slug}">Barcha materiallar</a>
      </div>
    </section>
  `;
}

function renderHomePage(user) {
  const featured = featuredArticle();
  const latest = latestArticles(8);
  const trend = trendingArticles(4);
  const stats = analyticsSnapshot();
  const published = getPublishedArticles();
  const quickFeed = published.slice(0, 8);
  const secondaryLead = published.filter((article) => article.id !== featured?.id).slice(0, 4);
  const technology = published.filter((article) => article.categorySlug === 'technology').slice(0, 4);
  const world = published.filter((article) => article.categorySlug === 'world').slice(0, 4);
  const business = published.filter((article) => article.categorySlug === 'business').slice(0, 4);
  const sports = published.filter((article) => article.categorySlug === 'sports').slice(0, 4);
  const culture = published.filter((article) => article.categorySlug === 'culture').slice(0, 4);
  const siteSignals = buildPageJsonLd([
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: store.settings.brand.siteName,
      description: store.settings.brand.heroDescription,
      url: store.settings.siteUrl,
    },
  ]);
  return renderLayout({
    title: `${store.settings.brand.siteName} | Official News Platform`,
    description: store.settings.brand.heroDescription,
    canonical: store.settings.siteUrl,
    image: featured ? articleImageUrl(featured) : logoUrl(),
    activePath: '/',
    structuredData: siteSignals,
    user,
    content: `
      <section class="hero">
        <div class="lead-grid">
          <article class="card lead-story">
            ${featured ? `<a href="/news/${featured.slug}"><img class="lead-story-image" src="${articleImageUrl(featured)}" alt="${escapeHtml(featured.title)}" /></a>` : ''}
            <div class="lead-story-content">
              <span class="eyebrow">Asosiy yangilik</span>
              <h1>${escapeHtml(featured?.title || store.settings.brand.heroTitle)}</h1>
              <p>${escapeHtml(featured?.excerpt || store.settings.brand.heroDescription)}</p>
              <div class="meta-row">
                <span>${escapeHtml(featured?.categoryLabel || 'Yangiliklar')}</span>
                <span>${formatDateTime(featured?.publishedAt || new Date().toISOString())}</span>
                <span>${featured?.readingMinutes || 2} min o'qish</span>
              </div>
              <div class="hero-actions" style="margin-top:16px">
                ${featured ? `<a class="btn btn-primary" href="/news/${featured.slug}">Batafsil o'qish</a>` : ''}
                <a class="btn" href="/apply">Muallif bo'lish</a>
              </div>
            </div>
          </article>
          <div class="home-sidebar">
            <div class="panel headline-panel">
              <div class="panel-head">Muharrir tanlovi</div>
              ${secondaryLead.map((article) => renderHeadlineItem(article, true)).join('')}
            </div>
            <div class="panel">
              <div class="panel-head">Qisqa ko'rsatkichlar</div>
              <div class="market-grid">
                <div class="market-tile"><strong>${stats.totalVisits}</strong><span class="small">Jami kirishlar</span></div>
                <div class="market-tile"><strong>${stats.totalAuthors}</strong><span class="small">Mualliflar</span></div>
                <div class="market-tile"><strong>${stats.publishedArticles}</strong><span class="small">Chop etilganlar</span></div>
                <div class="market-tile"><strong>${stats.subscribers}</strong><span class="small">Obunachilar</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="notice" style="margin-top:14px">${escapeHtml(store.settings.brand.announcement)}</div>
        <div class="home-tag-cloud">
          ${categoryStats()
            .map(
              (category) =>
                `<a class="tag-link" href="/category/${category.slug}">${escapeHtml(category.label)} <strong>${category.count}</strong></a>`,
            )
            .join('')}
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>So'nggi yangiliklar</h2>
            <p class="muted">Daryo uslubiga yaqin zich newsroom lenta: ko'proq sarlavha, kamroq shovqin, tezroq skanerlash.</p>
          </div>
          <a class="btn" href="/search">Qidiruvni ochish</a>
        </div>
        ${
          latest.length
            ? `
              <div class="feature-grid">
                <div class="news-grid">
                  ${latest.slice(0, 6).map(renderArticleCard).join('')}
                </div>
                <aside class="panel">
                  <div class="panel-head">Lenta</div>
                  ${quickFeed.map((article) => renderHeadlineItem(article, false)).join('')}
                </aside>
              </div>
            `
            : renderEmptyState(
                'Newsroom hozircha bo\'sh',
                'Demo materiallar olib tashlandi. Endi admin yoki muallif panelidan real xabarlarni joylash bilan sahifa to\'la newsroom ko\'rinishiga o\'tadi.',
                '/writer',
                'Muallif xonasini ochish',
              )
        }
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>Bo'limlar</h2>
            <p class="muted">O'zbekiston news portaliga xos bo'lgan ko'p-bo'limli, sarlavha markazidagi oqim saqlab qolindi.</p>
          </div>
        </div>
        <div class="section-columns">
          ${renderTopicPanel('Texnologiya', technology.length ? technology : latest.slice(0, 4), 'technology')}
          ${renderTopicPanel('Dunyo', world.length ? world : latest.slice(1, 5), 'world')}
          ${renderTopicPanel('Biznes', business.length ? business : latest.slice(2, 6), 'business')}
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>Tavsiyalar</h2>
            <p class="muted">Trend, sport va madaniyat bloklari Daryo.uz dagi ko'p qatlamli kontent oqimiga yaqinlashtirildi.</p>
          </div>
        </div>
        <div class="section-columns">
          <div class="card feature-wide">
            ${trend[0] ? `
              <article class="topic-feature">
                <a href="/news/${trend[0].slug}"><img src="${articleImageUrl(trend[0])}" alt="${escapeHtml(trend[0].title)}" /></a>
                <span class="kicker">Trend</span>
                <h3><a href="/news/${trend[0].slug}">${escapeHtml(trend[0].title)}</a></h3>
                <p>${escapeHtml(trend[0].excerpt)}</p>
              </article>
            ` : '<div class="empty-state"><h3>Trend yo\'q</h3><p>Ko\'proq material joylangach, trend bloklari avtomatik shakllanadi.</p></div>'}
          </div>
          ${renderTopicPanel('Sport', sports.length ? sports : latest.slice(3, 7), 'sports')}
          ${renderTopicPanel('Madaniyat', culture.length ? culture : latest.slice(0, 4), 'culture')}
        </div>
      </section>

      <section class="section">
        <div class="feature-grid">
          <div class="card">
            <span class="kicker">Bildirishnomalar</span>
            <h3>Yangiliklarni qo'ldan chiqarmaslik</h3>
            <p>Yangi xabarlar haqida tezkor bildirishnomalar o‘quvchini doimiy xabardor qiladi.</p>
            <button class="btn btn-primary" type="button" data-notify-toggle>Bildirishnomalarni yoqish</button>
          </div>
          <div class="card">
            <span class="kicker">Nashr jarayoni</span>
            <h3>Muallif va boshqaruv jarayoni</h3>
            <p>Muallif arizasi, material tayyorlash, rasm qo‘shish va boshqaruv tasdig‘i bir tartibli jarayonda ishlaydi.</p>
            <div class="hero-actions">
              <a class="btn" href="/writer">Muallif xonasi</a>
              <a class="btn" href="/admin">Boshqaruv markazi</a>
            </div>
          </div>
        </div>
      </section>
    `,
  });
}

function renderCategoryPage(slug, user) {
  const items = getPublishedArticles().filter((article) => article.categorySlug === slug);
  const label = categoryLabel(slug);
  return renderLayout({
    title: `${label} yangiliklari | ${store.settings.brand.siteName}`,
    description: `${label} bo'yicha Hallaym Newsroom rasmiy xabarlari va qulay yangiliklar sahifasi.`,
    canonical: `${store.settings.siteUrl}/category/${slug}`,
    image: items[0] ? articleImageUrl(items[0]) : logoUrl(),
    activePath: `/category/${slug}`,
    structuredData: buildPageJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${label} yangiliklari`,
        description: `${label} bo'yicha eng so'nggi materiallar`,
        url: `${store.settings.siteUrl}/category/${slug}`,
      },
    ]),
    user,
    content: `
      <section class="page-intro">
        <span class="eyebrow">Category landing</span>
        <h1>${escapeHtml(label)} sahifasi</h1>
        <p>${escapeHtml(label)} bo'yicha indeksatsiyaga tayyor materiallar, muallif bloklari va tavsiyalar bilan boyitilgan landing page.</p>
      </section>
      ${
        items.length
          ? `<div class="news-grid">${items.map(renderArticleCard).join('')}</div>`
          : renderEmptyState(
              `${label} bo'limida material hali yo'q`,
              'Bu kategoriya real kontent bilan to\'ldirilishi uchun writer yoki boshqaruv markazidan post yarating.',
              '/writer',
              'Post yaratish',
            )
      }
    `,
  });
}

function renderAuthorsPage(user) {
  const authors = store.users.filter((candidate) => candidate.role === 'author');
  return renderLayout({
    title: `Mualliflar | ${store.settings.brand.siteName}`,
    description: 'Hallaym Newsroom mualliflari, profillari va so\'nggi materiallari.',
    canonical: `${store.settings.siteUrl}/authors`,
    image: logoUrl(),
    activePath: '/authors',
    structuredData: buildPageJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: authors.map((author, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${store.settings.siteUrl}/author/${author.slug}`,
        })),
      },
    ]),
    user,
    content: `
      <section class="page-intro">
        <span class="eyebrow">Author transparency</span>
        <h1>Mualliflar va editorial jamoa</h1>
        <p>Google News transparency tamoyillari uchun muallif profillari, bio va aloqalar alohida ko'rsatiladi.</p>
      </section>
      ${
        authors.length
          ? `
            <div class="news-grid">
              ${authors.map((author) => {
                const posts = authorArticles(author.id).filter((article) => article.status === 'published');
                return `
                  <article class="card">
                    <span class="kicker">${escapeHtml(author.title)}</span>
                    <h3><a href="/author/${author.slug}">${escapeHtml(author.name)}</a></h3>
                    <p>${escapeHtml(author.bio)}</p>
                    <div class="meta-row">
                      <span>${posts.length} ta post</span>
                      <span>${formatDate(author.joinedAt)}</span>
                    </div>
                    <div style="margin-top:16px">
                      <a class="btn" href="/author/${author.slug}">Profilni ochish</a>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          `
          : renderEmptyState(
              'Tasdiqlangan mualliflar hali yo\'q',
              'Muallif arizasi yuborilganidan keyin admin tasdiq qilsa, mualliflar shu sahifada ko\'rinadi.',
              '/apply',
              'Muallif bo\'lish uchun ariza',
            )
      }
    `,
  });
}

function renderAuthorPage(slug, user) {
  const author = store.users.find((candidate) => candidate.slug === slug && candidate.role === 'author');
  if (!author) {
    return null;
  }
  const items = authorArticles(author.id).filter((article) => article.status === 'published');
  return renderLayout({
    title: `${author.name} | ${store.settings.brand.siteName}`,
    description: `${author.name} profili, bio va Hallaym Newsroom'dagi maqolalari.`,
    canonical: `${store.settings.siteUrl}/author/${author.slug}`,
    image: logoUrl(),
    activePath: '/authors',
    structuredData: buildPageJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: author.name,
        jobTitle: author.title,
        description: author.bio,
        url: `${store.settings.siteUrl}/author/${author.slug}`,
      },
    ]),
    user,
    content: `
      <section class="page-intro">
        <span class="eyebrow">Author profile</span>
        <h1>${escapeHtml(author.name)}</h1>
        <p>${escapeHtml(author.bio)}</p>
        <div class="chips">
          <span class="chip">${escapeHtml(author.title)}</span>
          <span class="chip">${items.length} ta chop etilgan post</span>
        </div>
      </section>
      <div class="news-grid">
        ${items.map(renderArticleCard).join('')}
      </div>
    `,
  });
}

function renderAboutPage(user) {
  return renderLayout({
    title: `About & editorial policy | ${store.settings.brand.siteName}`,
    description: 'Hallaym Newsroom ownership, editorial policy, corrections va transparency sahifasi.',
    canonical: `${store.settings.siteUrl}/about`,
    image: logoUrl(),
    activePath: '/about',
    structuredData: buildPageJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: 'About & editorial policy',
        url: `${store.settings.siteUrl}/about`,
      },
    ]),
    user,
    content: `
      <section class="page-intro">
        <span class="eyebrow">Official transparency page</span>
        <h1>About, ownership va editorial policy</h1>
        <p>Bu sahifa Hallaym Newsroom'ning rasmiyligi, kimga tegishli ekani, tahrir tamoyillari va xatolarni tuzatish tartibini ochiq ko'rsatadi.</p>
      </section>
      <div class="news-grid">
        <div class="card">
          <h3>Ownership</h3>
          <p>${escapeHtml(store.settings.brand.ownerName)} newsroom platformaning mahsulot va tarqatish strategiyasini yuritadi. Newsroom email: ${escapeHtml(store.settings.brand.newsroomEmail)}.</p>
        </div>
        <div class="card">
          <h3>Editorial tamoyillar</h3>
          <p>Har bir material muallif, yangilangan sana va mavzu konteksti bilan chiqadi. Noaniq yoki reklama xarakteridagi materiallar alohida belgilanishi kerak.</p>
        </div>
        <div class="card">
          <h3>Corrections policy</h3>
          <p>Xato aniqlansa, maqola yangilanadi, tahrir vaqti ko'rsatiladi va zarur hollarda izoh qoldiriladi.</p>
        </div>
        <div class="card">
          <h3>AI disclosure</h3>
          <p>AI vositalari faqat yordamchi qatlam sifatida ishlatiladi; yakuniy editorial javobgarlik inson muharrirlarda qoladi.</p>
        </div>
        <div class="card">
          <h3>Tarqatish siyosati</h3>
          <p>Materiallar ochiq, tartibli va qidiruvga mos ko‘rinishda taqdim etiladi. Yakuniy ko‘rinish tashqi platformalar qaroriga bog‘liq.</p>
        </div>
        <div class="card">
          <h3>Muallif shaffofligi</h3>
          <p>Har bir tasdiqlangan muallif alohida profil, qisqa ma’lumot va materiallar portfeli bilan ko‘rsatiladi. Noma’lum muallif postingi tavsiya etilmaydi.</p>
        </div>
      </div>
    `,
  });
}

function renderContactPage(user) {
  return renderLayout({
    title: `Contact newsroom | ${store.settings.brand.siteName}`,
    description: 'Hallaym Newsroom bilan bog\'lanish, media tips, muallif arizasis va support ma\'lumotlari.',
    canonical: `${store.settings.siteUrl}/contact`,
    image: logoUrl(),
    activePath: '/contact',
    structuredData: buildPageJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        name: 'Contact newsroom',
        url: `${store.settings.siteUrl}/contact`,
      },
    ]),
    user,
    content: `
      <section class="page-intro">
        <span class="eyebrow">Newsroom contact</span>
        <h1>Aloqa va media signal kanallari</h1>
        <p>Tip yuborish, hamkorlik, correction talab qilish yoki muallif bo'lish uchun quyidagi kanallardan foydalaning.</p>
      </section>
      <div class="feature-grid">
        <div class="card">
          <h3>Asosiy aloqa</h3>
          <p>Email: ${escapeHtml(store.settings.brand.newsroomEmail)}</p>
          <p>Telefon: ${escapeHtml(store.settings.brand.phone)}</p>
          <p>Manzil: ${escapeHtml(store.settings.brand.address)}</p>
          <div class="chips">
            <a class="chip" href="${escapeHtml(store.settings.brand.telegram)}" target="_blank" rel="noreferrer">Telegram</a>
            <a class="chip" href="${escapeHtml(store.settings.brand.youtube)}" target="_blank" rel="noreferrer">YouTube</a>
          </div>
        </div>
        <div class="card">
          <h3>Tezkor yo'nalishlar</h3>
          <p><a href="/apply">Muallif bo'lish uchun ariza topshirish</a></p>
          <p><a href="/login">Muallif yoki boshqaruv xonasiga kirish</a></p>
          <p><a href="/rss.xml">Yangiliklar oqimi orqali obuna bo‘lish</a></p>
        </div>
      </div>
    `,
  });
}

function legalPageContent(type) {
  const privacy = {
    title: `Maxfiylik siyosati | ${store.settings.brand.siteName}`,
    heading: 'Maxfiylik siyosati',
    description: 'Hallaym foydalanuvchi ma’lumotlari, akkaunt, obuna va mualliflik arizasi bo‘yicha maxfiylik siyosati.',
    summary: 'Bu hujjat ro‘yxatdan o‘tish, mualliflik arizasi, kabinetga kirish, obuna va bildirishnomalar uchun kiritilgan ma’lumotlar qanday himoya qilinishini tushuntiradi.',
    sections: [
      {
        title: '1. Qanday ma’lumotlar olinadi',
        items: [
          'Ro‘yxatdan o‘tishda ism, email va parol himoyalangan ko‘rinishda saqlanadi.',
          'Muallif bo‘lish arizasida ism, email, yo‘nalish va taklif matni ko‘rib chiqish uchun qabul qilinadi.',
          'Kabinetga kirgan foydalanuvchini tanish va xavfsiz holatda saqlash uchun vaqtinchalik kirish belgisi ishlatiladi.',
          'Sahifa ko‘rishlari va umumiy tashriflar xizmat sifatini yaxshilash uchun hisoblanishi mumkin.',
          'Bildirishnoma yoqilganda foydalanuvchiga yangi xabarlar haqida xabar berish uchun kerakli ruxsatlar saqlanishi mumkin.'
        ]
      },
      {
        title: '2. Ma’lumotlardan foydalanish maqsadi',
        items: [
          'Akkaunt yaratish, kabinetga kirishni ta’minlash va foydalanuvchini tanish.',
          'Muallif arizasini tekshirish, tasdiqlash yoki rad etish.',
          'Sayt sifatini oshirish, materiallar o‘qilishini baholash va xizmatdagi muammolarni kamaytirish.',
          'Yangiliklar oqimi, bildirishnomalar va qidiruvga mos taqdimotni yuritish.',
          'Spam, plagiat va xavfli kontentni kamaytirish.'
        ]
      },
      {
        title: '3. Kirish holati va eslab qolish',
        items: [
          'Kabinetga kirish holati cheklangan muddat davomida saqlanishi mumkin.',
          'Tashrif statistikasi umumiy ko‘rinishda hisoblanadi va xizmatni yaxshilashga yordam beradi.',
          'Brauzer ma’lumotlari tozalansa, ayrim bo‘limlarga qayta kirish talab qilinishi mumkin.',
          'Xavfsizlik uchun kuchli parol va shaxsiy qurilmadan foydalanish tavsiya qilinadi.'
        ]
      },
      {
        title: '4. Hamkor xizmatlar',
        items: [
          'Rasmlarni xavfsiz joylash, kontentni ishonchli saqlash va yangilangan materiallarni qidiruv platformalariga yetkazish uchun ishonchli xizmatlardan foydalanilishi mumkin.',
          'Har bir hamkor xizmat o‘z xavfsizlik va maxfiylik siyosatiga ega.',
          'Hallaym foydalanuvchi ma’lumotlarini faqat xizmat sifati va xavfsizligi uchun zarur doirada ishlatadi.'
        ]
      },
      {
        title: '5. Ma’lumotlarni himoyalash',
        items: [
          'Parollar oddiy matn ko‘rinishida saqlanmaydi.',
          'Boshqaruv va muallif xonalari foydalanuvchi huquqlariga qarab himoyalanadi.',
          'Muallif materiali ommaga chiqishidan oldin boshqaruv tasdig‘idan o‘tadi.',
          'Sayt egasi xavfsizlikni kuchaytirish, kirishni cheklash va shubhali faoliyatni to‘xtatish huquqiga ega.'
        ]
      },
      {
        title: '6. Foydalanuvchi huquqlari',
        items: [
          'Foydalanuvchi akkaunt ma’lumotlarini yangilash yoki o‘chirish bo‘yicha tahririyat bilan bog‘lanishi mumkin.',
          'Muallif o‘z profili va yuborgan materiallari bo‘yicha boshqaruv jamoasiga murojaat qilishi mumkin.',
          'Bildirishnoma ruxsatini brauzer sozlamalaridan istalgan vaqtda o‘chirish mumkin.'
        ]
      }
    ]
  };
  const terms = {
    title: `Foydalanish shartlari | ${store.settings.brand.siteName}`,
    heading: 'Foydalanish shartlari',
    description: 'Hallaym platformasidan foydalanish, mualliflik, tasdiqlash jarayoni va kontent qoidalari.',
    summary: 'Bu hujjat akkaunt ochish, muallif bo‘lish, material yuborish va boshqaruv tasdig‘i bo‘yicha asosiy qoidalarni belgilaydi.',
    sections: [
      {
        title: '1. Platformadan foydalanish',
        items: [
          'Saytdan qonuniy, odobli va xavfsiz maqsadlarda foydalanish kerak.',
          'Akkaunt ma’lumotlari to‘g‘ri va o‘zingizga tegishli bo‘lishi kerak.',
          'Boshqa foydalanuvchi, muallif yoki boshqaruvchi akkauntiga ruxsatsiz kirish taqiqlanadi.',
          'Platforma sifat va xavfsizlik sababli ayrim imkoniyatlarni vaqtincha cheklashi mumkin.'
        ]
      },
      {
        title: '2. Mualliflik va ariza',
        items: [
          'Muallif bo‘lish uchun ariza yuborilganda kiritilgan ma’lumotlar boshqaruv jamoasi tomonidan tekshiriladi.',
          'Tasdiqlangandan keyin muallif huquqi beriladi.',
          'Muallif material yaratishi mumkin, lekin material ommaga chiqishi uchun boshqaruv tasdig‘idan o‘tadi.',
          'Boshqaruvchi muallif huquqini bekor qilish, profilni tahrirlash yoki materialni yashirish huquqiga ega.'
        ]
      },
      {
        title: '3. Kontent talablari',
        items: [
          'Spam, plagiat, haqorat, adovat, manipulyativ yoki noqonuniy kontent qabul qilinmaydi.',
          'Yangilik materialida sarlavha, qisqa tavsif, kategoriya, muqova rasmi va aniq kontekst bo‘lishi tavsiya qilinadi.',
          'Muallif faktlarni tekshirishi va zarur manbalarni ko‘rsatishi kerak.',
          'Reklama, hamkorlik yoki manfaatlar to‘qnashuvi bo‘lsa, bu ochiq belgilanadi.'
        ]
      },
      {
        title: '4. Tasdiqlash va boshqaruv huquqlari',
        items: [
          'Boshqaruvchi materialni qoralama, ko‘rib chiqish yoki e’lon qilingan holatga o‘tkazishi mumkin.',
          'Boshqaruvchi maqolani tahrirlashi, o‘chirishi yoki nashrdan olib tashlashi mumkin.',
          'Boshqaruvchi muallif arizasini tasdiqlashi yoki rad etishi mumkin.',
          'Tahririy xavfsizlik va o‘quvchi ishonchi platformaning ustuvor talabi hisoblanadi.'
        ]
      },
      {
        title: '5. Intellektual mulk',
        items: [
          'Muallif yuborgan matn, rasm va media bo‘yicha huquqlarga ega bo‘lishi yoki ulardan foydalanish ruxsatiga ega bo‘lishi kerak.',
          'Sayt brendi, logotipi, dizayni va tahririy materiallar ruxsatsiz ko‘chirilmasligi kerak.',
          'Muallif materialni yuborish orqali uni Hallaym’da ko‘rsatishga ruxsat beradi.'
        ]
      },
      {
        title: '6. Javobgarlik chegarasi',
        items: [
          'Platforma doimiy ishlashini kafolatlamaydi; vaqtinchalik uzilishlar bo‘lishi mumkin.',
          'Tashqi havolalar va uchinchi tomon kontenti uchun ular o‘z siyosatiga javob beradi.',
          'Foydalanuvchi platformadan foydalanishda ushbu qoidalarga rioya qilishga rozilik bildiradi.'
        ]
      }
    ]
  };
  return type === 'privacy' ? privacy : terms;
}

function renderSimplePolicyPage(type, user) {
  const page = legalPageContent(type);
  const cards = page.sections
    .map((section) => `
      <section class="card">
        <h2>${escapeHtml(section.title)}</h2>
        <ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>
    `)
    .join('');
  return renderLayout({
    title: page.title,
    description: page.description,
    canonical: `${store.settings.siteUrl}/${type}`,
    image: logoUrl(),
    activePath: '/about',
    structuredData: buildPageJsonLd([]),
    user,
    content: `
      <section class="page-intro">
        <span class="eyebrow">Rasmiy hujjat</span>
        <h1>${escapeHtml(page.heading)}</h1>
        <p>${escapeHtml(page.summary)}</p>
        <div class="compact-actions">
          <a class="btn" href="/${type}.pdf">PDF yuklab olish</a>
          <a class="btn" href="/${type === 'privacy' ? 'terms' : 'privacy'}">${type === 'privacy' ? 'Foydalanish shartlari' : 'Maxfiylik siyosati'}</a>
        </div>
      </section>
      <div class="legal-document">${cards}</div>
    `,
  });
}

function pdfEscape(value) {
  return String(value || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}


function wrapPdfLine(text, limit = 92) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > limit) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function makeLegalPdf(type) {
  const page = legalPageContent(type);
  const lines = [page.heading, page.summary, ''];
  for (const section of page.sections) {
    lines.push(section.title);
    for (const item of section.items) {
      wrapPdfLine('- ' + item).forEach((line) => lines.push(line));
    }
    lines.push('');
  }
  const pageChunks = [];
  let chunk = [];
  for (const line of lines) {
    if (chunk.length >= 42) {
      pageChunks.push(chunk);
      chunk = [];
    }
    chunk.push(line);
  }
  if (chunk.length) pageChunks.push(chunk);

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const contentIds = [];
  for (const chunkLines of pageChunks) {
    const content = ['BT', '/F1 11 Tf', '50 792 Td', '14 TL'];
    chunkLines.forEach((line, index) => {
      const font = index === 0 ? '/F1 18 Tf' : (line.match(/^\d+\./) ? '/F1 13 Tf' : '/F1 11 Tf');
      content.push(font);
      content.push(`(${pdfEscape(line)}) Tj`);
      content.push('T*');
    });
    content.push('ET');
    const stream = content.join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    contentIds.push(contentId);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}


function renderArticlePage(article, user) {
  const author = getUserById(article.authorId);
  const readiness = publisherReadiness(article);
  const resourceSections = renderArticleResourceSections(article);
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Bosh sahifa', item: `${store.settings.siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: article.categoryLabel, item: `${store.settings.siteUrl}/category/${article.categorySlug}` },
      { '@type': 'ListItem', position: 3, name: article.title, item: `${store.settings.siteUrl}/news/${article.slug}` },
    ],
  };
  const newsArticle = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.seoDescription,
    image: [articleImageUrl(article)],
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      '@type': 'Person',
      name: author?.name || 'Hallaym Team',
      url: author ? `${store.settings.siteUrl}/author/${author.slug}` : `${store.settings.siteUrl}/authors`,
    },
    publisher: {
      '@type': 'NewsMediaOrganization',
      name: store.settings.brand.siteName,
      logo: {
        '@type': 'ImageObject',
        url: logoUrl(),
      },
    },
    mainEntityOfPage: `${store.settings.siteUrl}/news/${article.slug}`,
    articleSection: article.categoryLabel,
    keywords: article.tags.join(', '),
    inLanguage: article.language,
  };
  return renderLayout({
    title: article.seoTitle,
    description: article.seoDescription,
    canonical: `${store.settings.siteUrl}/news/${article.slug}`,
    image: articleImageUrl(article),
    activePath: `/category/${article.categorySlug}`,
    structuredData: buildPageJsonLd([breadcrumb, newsArticle]),
    user,
    content: `
      <article class="article-layout">
        <div>
          <div class="breadcrumbs">
            <a href="/">Bosh sahifa</a> /
            <a href="/category/${article.categorySlug}">${escapeHtml(article.categoryLabel)}</a> /
            <span>${escapeHtml(article.title)}</span>
          </div>
          <header class="article-meta">
            <span class="kicker">${escapeHtml(article.kicker || article.categoryLabel)}</span>
            <h1>${escapeHtml(article.title)}</h1>
            <p class="lede">${escapeHtml(article.excerpt)}</p>
            <div class="meta-row">
              <span>${escapeHtml(author?.name || 'Hallaym Team')}</span>
              <span>${formatDateTime(article.publishedAt)}</span>
              <span>Yangilandi: ${formatDateTime(article.updatedAt)}</span>
              <span>${article.readingMinutes} min o'qish</span>
            </div>
            <div class="chips" style="margin-top:14px">
              ${article.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
            </div>
          </header>
          <img class="lead-image" src="${articleImageUrl(article)}" alt="${escapeHtml(article.title)}" />
          <div class="article-body card">
            ${article.sections
              .map(
                (section) => `
                  ${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}
                  ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
                  ${section.bullets && section.bullets.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}
                `,
              )
              .join('')}
          </div>
          ${resourceSections}
          <section class="section">
            <div class="feature-grid">
              <div class="card">
                <span class="kicker">O‘quvchi qulayligi</span>
                <h3>O'quvchi reaksiyasi</h3>
                <p>Like, view va keyingi tavsiyalar foydalanuvchi qaytishini oshirish uchun ishlatiladi.</p>
                <div class="meta-row">
                  <span><strong id="likes-count">${article.likes}</strong> yoqtirish</span>
                  <span>${article.views} ko‘rish</span>
                </div>
                <div class="reader-actions" style="margin-top:16px">
                  <button class="btn btn-primary" type="button" data-like-article="${article.slug}">Yoqtirish</button>
                  <button class="btn" type="button" data-save-article="${article.slug}">Saqlab qo‘yish</button>
                  <button class="btn" type="button" data-share-article="${article.slug}">Ulashish</button>
                  <button class="btn" type="button" data-copy-article="${article.slug}">Havolani olish</button>
                </div>
              </div>
              <div class="card">
                <span class="kicker">Keyingi o‘qishlar</span>
                <h3>Keyingi tavsiyalar</h3>
                <p>Shu mavzuga yaqin yoki bir xil kategoriya ichidagi materiallar avtomatik tavsiya qilinadi.</p>
                <div class="list-clean">
                  ${relatedArticles(article, 3)
                    .map(
                      (related) => `
                        <div class="list-item">
                          <span class="small">${escapeHtml(related.categoryLabel)} • ${formatDate(related.publishedAt)}</span>
                          <h3 style="font-size:1.2rem"><a href="/news/${related.slug}">${escapeHtml(related.title)}</a></h3>
                        </div>
                      `,
                    )
                    .join('')}
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside class="stack">
          <div class="aside-card">
            <h3>Muallif</h3>
            <p><strong>${escapeHtml(author?.name || 'Hallaym Team')}</strong></p>
            <p>${escapeHtml(author?.bio || 'Hallaym Newsroom jamoasi material tayyorladi.')}</p>
            ${author ? `<a class="btn" href="/author/${author.slug}">Profilni ochish</a>` : ''}
          </div>
          <div class="aside-card">
            <h3>Nashr tayyorgarligi</h3>
            <div class="stack">
              <div>${renderReadinessPill(readiness.google.status)} <span class="small">${escapeHtml(readiness.google.label)}</span></div>
              <div>${renderReadinessPill(readiness.bing.status)} <span class="small">${escapeHtml(readiness.bing.label)}</span></div>
              <div>${renderReadinessPill(readiness.yahoo.status)} <span class="small">${escapeHtml(readiness.yahoo.label)}</span></div>
              <div>${renderReadinessPill(readiness.opera.status)} <span class="small">${escapeHtml(readiness.opera.label)}</span></div>
            </div>
          </div>
          <div class="aside-card">
            <h3>Obuna</h3>
            <p>Bildirishnomalarni yoqib, yangi xabarlarni birinchi bo‘lib oling.</p>
            <button class="btn btn-primary" type="button" data-notify-toggle>Bildirishnomalar</button>
          </div>
        </aside>
      </article>
      <section class="section">
        <div class="section-head">
          <div>
            <h2>O'xshash yangiliklar</h2>
            <p class="muted">Ichki tavsiyalar va o‘xshash materiallar qulay ko‘rsatiladi.</p>
          </div>
        </div>
        <div class="news-grid">
          ${relatedArticles(article, 3).map(renderArticleCard).join('')}
        </div>
      </section>
      <script>
        document.addEventListener('DOMContentLoaded', function () {
          const button = document.querySelector('[data-like-article="${article.slug}"]');
          const likesNode = document.getElementById('likes-count');
          const articleUrl = '${store.settings.siteUrl}/news/${article.slug}';
          if (!window.Hallaym) return;
          if (button) {
            button.addEventListener('click', async function () {
              try {
                const data = await window.Hallaym.request('/api/articles/${article.slug}/like', { method: 'POST' });
                likesNode.textContent = data.likes;
                window.Hallaym.toast('Like qabul qilindi.');
              } catch (error) {
                window.Hallaym.toast(error.message);
              }
            });
          }
          const saveButton = document.querySelector('[data-save-article="${article.slug}"]');
          if (saveButton) {
            saveButton.addEventListener('click', function () {
              const saved = JSON.parse(localStorage.getItem('hallaym:saved') || '[]');
              const item = { slug: '${article.slug}', title: ${JSON.stringify(article.title)}, url: articleUrl, savedAt: new Date().toISOString() };
              const next = [item].concat(saved.filter((entry) => entry.slug !== item.slug)).slice(0, 50);
              localStorage.setItem('hallaym:saved', JSON.stringify(next));
              window.Hallaym.toast('Material saqlandi.');
            });
          }
          const shareButton = document.querySelector('[data-share-article="${article.slug}"]');
          if (shareButton) {
            shareButton.addEventListener('click', async function () {
              try {
                if (navigator.share) {
                  await navigator.share({ title: ${JSON.stringify(article.title)}, text: ${JSON.stringify(article.excerpt)}, url: articleUrl });
                } else {
                  await navigator.clipboard.writeText(articleUrl);
                  window.Hallaym.toast('Havola nusxalandi.');
                }
              } catch (error) {
                if (error.name !== 'AbortError') window.Hallaym.toast(error.message);
              }
            });
          }
          const copyButton = document.querySelector('[data-copy-article="${article.slug}"]');
          if (copyButton) {
            copyButton.addEventListener('click', async function () {
              await navigator.clipboard.writeText(articleUrl);
              window.Hallaym.toast('Havola nusxalandi.');
            });
          }
        });
      </script>
    `,
  });
}

function renderNotFound(user) {
  return renderLayout({
    title: `Sahifa topilmadi | ${store.settings.brand.siteName}`,
    description: 'So\'ralgan sahifa mavjud emas.',
    canonical: `${store.settings.siteUrl}/404`,
    image: logoUrl(),
    activePath: '/',
    robots: 'noindex,follow',
    structuredData: buildPageJsonLd([]),
    user,
    content: `
      <section class="page-intro center">
        <span class="eyebrow">404</span>
        <h1>Sahifa topilmadi</h1>
        <p>URL noto'g'ri bo'lishi mumkin yoki material ko'chirilgan. Bosh sahifadan davom etishingiz mumkin.</p>
        <div style="margin-top:18px"><a class="btn btn-primary" href="/">Bosh sahifaga qaytish</a></div>
      </section>
    `,
  });
}

function renderLogoSvg() {
  const brand = store.settings.brand;
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${escapeHtml(brand.siteName)}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0a65c7"/>
        <stop offset="100%" stop-color="#12365b"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="96" fill="#f6fbff"/>
    <rect x="34" y="34" width="444" height="444" rx="72" fill="url(#g)" opacity="0.16"/>
    <text x="64" y="212" font-family="Manrope, Arial, sans-serif" font-size="140" font-weight="800" fill="#0a65c7">HN</text>
    <text x="68" y="302" font-family="Manrope, Arial, sans-serif" font-size="34" font-weight="700" fill="#12365b">${escapeHtml(brand.shortName)}</text>
    <text x="68" y="346" font-family="Manrope, Arial, sans-serif" font-size="34" font-weight="700" fill="#12365b">${escapeHtml(brand.accent)}</text>
    <text x="68" y="394" font-family="Manrope, Arial, sans-serif" font-size="22" fill="#6b7f98">Official newsroom</text>
  </svg>`;
}

function renderArticleSvg(article) {
  const palette = {
    technology: ['#0a65c7', '#12365b'],
    business: ['#0a65c7', '#1b4b7d'],
    society: ['#1574b5', '#1a3553'],
    world: ['#005db8', '#122f53'],
    sports: ['#1d7bd8', '#153252'],
    culture: ['#467bb8', '#19314d'],
  };
  const [first, second] = palette[article.categorySlug] || ['#0a65c7', '#12365b'];
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="${escapeHtml(article.title)}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${first}"/>
        <stop offset="100%" stop-color="${second}"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="#0f1724"/>
    <rect x="36" y="36" width="1528" height="828" rx="40" fill="url(#bg)" opacity="0.22"/>
    <circle cx="1320" cy="180" r="240" fill="${first}" opacity="0.16"/>
    <circle cx="220" cy="760" r="280" fill="${second}" opacity="0.28"/>
    <text x="100" y="180" font-family="Manrope, Arial, sans-serif" font-size="34" font-weight="800" fill="#f3e9da" letter-spacing="8">${escapeHtml(article.categoryLabel.toUpperCase())}</text>
    <text x="100" y="312" font-family="Spectral, Georgia, serif" font-size="84" font-weight="700" fill="#fffaf0">${escapeHtml(article.title).slice(0, 58)}</text>
    <text x="100" y="402" font-family="Manrope, Arial, sans-serif" font-size="28" fill="#f4d3b0">${escapeHtml(article.excerpt).slice(0, 110)}</text>
    <text x="100" y="760" font-family="Manrope, Arial, sans-serif" font-size="28" fill="#f3eadb">${escapeHtml(store.settings.brand.siteName)}</text>
    <text x="100" y="804" font-family="Manrope, Arial, sans-serif" font-size="24" fill="#d6c6b4">hallaym.com official news page</text>
  </svg>`;
}

function cloudinaryCapabilities() {
  return {
    enabled: runtimeState.cloudinary.enabled,
    cloudName: cloudinaryConfig.cloudName,
    folder: cloudinaryConfig.folder,
    uploadPreset: cloudinaryConfig.uploadPreset,
    signed: Boolean(cloudinaryConfig.apiKey && cloudinaryConfig.apiSecret),
    unsigned: Boolean(cloudinaryConfig.uploadPreset),
  };
}

function signCloudinaryParams(params) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`);
  return crypto.createHash('sha1').update(`${entries.join('&')}${cloudinaryConfig.apiSecret}`).digest('hex');
}


function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (error) {
    return 'Havola';
  }
}

function isLikelyUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function splitLineRecord(line) {
  return String(line || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeLinks(input, fallback = []) {
  const rawItems = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  const items = rawItems
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const url = safeHttpUrl(entry.url || entry.href || entry.link);
        if (!url) return null;
        return {
          label: String(entry.label || entry.title || hostLabel(url)).trim().slice(0, 90),
          url,
          note: String(entry.note || entry.description || '').trim().slice(0, 180),
        };
      }
      const parts = splitLineRecord(entry);
      if (!parts.length) return null;
      let label = '';
      let url = '';
      let note = '';
      if (parts.length === 1) {
        url = safeHttpUrl(parts[0]);
        label = hostLabel(url);
      } else if (isLikelyUrl(parts[0])) {
        url = safeHttpUrl(parts[0]);
        label = parts[1] || hostLabel(url);
        note = parts.slice(2).join(' • ');
      } else {
        label = parts[0];
        url = safeHttpUrl(parts[1]);
        note = parts.slice(2).join(' • ');
      }
      if (!url) return null;
      return { label: String(label || hostLabel(url)).slice(0, 90), url, note: String(note || '').slice(0, 180) };
    })
    .filter(Boolean)
    .slice(0, 18);
  return items.length || input !== undefined ? items : fallback;
}

function detectExternalPlatform(url) {
  const hostname = hostLabel(url).toLowerCase();
  if (hostname.includes('t.me') || hostname.includes('telegram')) return 'telegram';
  if (hostname.includes('instagram')) return 'instagram';
  if (hostname.includes('facebook') || hostname.includes('fb.watch')) return 'facebook';
  if (hostname.includes('likee')) return 'likee';
  if (hostname.includes('youtube') || hostname.includes('youtu.be')) return 'youtube';
  if (hostname.includes('tiktok')) return 'tiktok';
  if (hostname.includes('x.com') || hostname.includes('twitter')) return 'x';
  return 'external';
}

function platformLabel(platform) {
  const labels = {
    telegram: 'Telegram',
    instagram: 'Instagram',
    facebook: 'Facebook',
    likee: 'Likee',
    youtube: 'YouTube',
    tiktok: 'TikTok',
    x: 'X',
    external: 'Tashqi post',
  };
  return labels[platform] || 'Tashqi post';
}

function normalizeExternalPosts(input, fallback = []) {
  const rawItems = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  const items = rawItems
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const url = safeHttpUrl(entry.url || entry.href || entry.link);
        if (!url) return null;
        const platform = entry.platform || detectExternalPlatform(url);
        return {
          platform,
          label: String(entry.label || entry.title || platformLabel(platform)).trim().slice(0, 90),
          url,
          note: String(entry.note || entry.description || '').trim().slice(0, 180),
        };
      }
      const parts = splitLineRecord(entry);
      if (!parts.length) return null;
      let label = '';
      let url = '';
      let note = '';
      if (parts.length === 1) {
        url = safeHttpUrl(parts[0]);
      } else if (isLikelyUrl(parts[0])) {
        url = safeHttpUrl(parts[0]);
        label = parts[1] || '';
        note = parts.slice(2).join(' • ');
      } else {
        label = parts[0];
        url = safeHttpUrl(parts[1]);
        note = parts.slice(2).join(' • ');
      }
      if (!url) return null;
      const platform = detectExternalPlatform(url);
      return {
        platform,
        label: String(label || platformLabel(platform)).slice(0, 90),
        url,
        note: String(note || '').slice(0, 180),
      };
    })
    .filter(Boolean)
    .slice(0, 24);
  return items.length || input !== undefined ? items : fallback;
}

function normalizeMediaAssets(input, fallback = []) {
  const rawItems = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  const items = rawItems
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const url = safeHttpUrl(entry.url || entry.src || entry.href || entry.link);
        if (!url) return null;
        const type = ['image', 'video'].includes(entry.type) ? entry.type : inferMediaType(url);
        return {
          type,
          url,
          title: String(entry.title || '').trim().slice(0, 100),
          caption: String(entry.caption || entry.note || '').trim().slice(0, 180),
        };
      }
      const parts = splitLineRecord(entry);
      if (!parts.length) return null;
      let title = '';
      let url = '';
      let caption = '';
      if (parts.length === 1) {
        url = safeHttpUrl(parts[0]);
      } else if (isLikelyUrl(parts[0])) {
        url = safeHttpUrl(parts[0]);
        title = parts[1] || '';
        caption = parts.slice(2).join(' • ');
      } else {
        title = parts[0];
        url = safeHttpUrl(parts[1]);
        caption = parts.slice(2).join(' • ');
      }
      if (!url) return null;
      return {
        type: inferMediaType(url),
        url,
        title: String(title || '').slice(0, 100),
        caption: String(caption || '').slice(0, 180),
      };
    })
    .filter(Boolean)
    .slice(0, 30);
  return items.length || input !== undefined ? items : fallback;
}

function inferMediaType(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(clean) || /youtube\.com|youtu\.be|vimeo\.com/.test(clean)) {
    return 'video';
  }
  return 'image';
}

function mergeMediaInputs(input, fallback = []) {
  if (input.mediaAssets !== undefined) {
    return normalizeMediaAssets(input.mediaAssets, fallback);
  }
  const images = input.mediaImages !== undefined ? normalizeMediaAssets(input.mediaImages, []) : null;
  const videos = input.videoLinks !== undefined ? normalizeMediaAssets(input.videoLinks, []).map((item) => ({ ...item, type: 'video' })) : null;
  if (images || videos) {
    return [...(images || []), ...(videos || [])].slice(0, 30);
  }
  return fallback;
}

function lineTextFromLinks(items) {
  return (items || []).map((item) => [item.label, item.url, item.note].filter(Boolean).join(' | ')).join('\n');
}

function lineTextFromMedia(items, type) {
  return (items || [])
    .filter((item) => !type || item.type === type)
    .map((item) => [item.title, item.url, item.caption].filter(Boolean).join(' | '))
    .join('\n');
}

function lineTextFromExternalPosts(items) {
  return (items || []).map((item) => [item.label, item.url, item.note].filter(Boolean).join(' | ')).join('\n');
}

function youtubeEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    let id = '';
    if (parsed.hostname.includes('youtu.be')) {
      id = parsed.pathname.replace(/^\//, '').split('/')[0];
    } else if (parsed.searchParams.get('v')) {
      id = parsed.searchParams.get('v');
    } else if (parsed.pathname.includes('/embed/')) {
      id = parsed.pathname.split('/embed/')[1].split('/')[0];
    } else if (parsed.pathname.includes('/shorts/')) {
      id = parsed.pathname.split('/shorts/')[1].split('/')[0];
    }
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
  } catch (error) {
    return '';
  }
}

function renderArticleResourceSections(article) {
  const sourceLinks = normalizeLinks(article.sourceLinks || []);
  const mediaAssets = normalizeMediaAssets(article.mediaAssets || []);
  const images = mediaAssets.filter((item) => item.type === 'image');
  const videos = mediaAssets.filter((item) => item.type === 'video');
  const externalPosts = normalizeExternalPosts(article.externalPosts || []);
  const sections = [];

  if (sourceLinks.length) {
    sections.push(`
      <section class="article-resource-block">
        <div class="section-head compact-head">
          <div>
            <h2>Foydali havolalar</h2>
            <p class="muted">Mavzuga oid manbalar va qo‘shimcha o‘qishlar.</p>
          </div>
        </div>
        <div class="resource-grid">
          ${sourceLinks.map((item) => `
            <a class="resource-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
              <span>${escapeHtml(item.label)}</span>
              <small>${escapeHtml(item.note || hostLabel(item.url))}</small>
            </a>
          `).join('')}
        </div>
      </section>
    `);
  }

  if (images.length) {
    sections.push(`
      <section class="article-resource-block">
        <div class="section-head compact-head">
          <div>
            <h2>Rasm galereyasi</h2>
            <p class="muted">Materialga qo‘shimcha vizual lavhalar.</p>
          </div>
        </div>
        <div class="media-grid">
          ${images.map((item) => `
            <figure class="media-tile">
              <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.title || item.caption || article.title)}" loading="lazy" />
              ${item.caption || item.title ? `<figcaption>${escapeHtml(item.caption || item.title)}</figcaption>` : ''}
            </figure>
          `).join('')}
        </div>
      </section>
    `);
  }

  if (videos.length) {
    sections.push(`
      <section class="article-resource-block">
        <div class="section-head compact-head">
          <div>
            <h2>Video lavhalar</h2>
            <p class="muted">Mavzuni video orqali ko‘rish uchun qulay blok.</p>
          </div>
        </div>
        <div class="video-grid">
          ${videos.map((item) => {
            const youtubeUrl = youtubeEmbedUrl(item.url);
            if (youtubeUrl) {
              return `<div class="video-card"><iframe src="${escapeHtml(youtubeUrl)}" title="${escapeHtml(item.title || article.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>${item.caption || item.title ? `<p>${escapeHtml(item.caption || item.title)}</p>` : ''}</div>`;
            }
            return `<div class="video-card"><video src="${escapeHtml(item.url)}" controls preload="metadata"></video>${item.caption || item.title ? `<p>${escapeHtml(item.caption || item.title)}</p>` : ''}</div>`;
          }).join('')}
        </div>
      </section>
    `);
  }

  if (externalPosts.length) {
    sections.push(`
      <section class="article-resource-block">
        <div class="section-head compact-head">
          <div>
            <h2>Ijtimoiy postlar</h2>
            <p class="muted">Telegram, Instagram, Facebook, Likee va boshqa sahifalardagi postlar uchun xavfsiz preview.</p>
          </div>
        </div>
        <div class="social-grid">
          ${externalPosts.map((item) => `
            <a class="social-card platform-${escapeHtml(item.platform)}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(platformLabel(item.platform))}</strong>
              <span>${escapeHtml(item.label || platformLabel(item.platform))}</span>
              <small>${escapeHtml(item.note || hostLabel(item.url))}</small>
            </a>
          `).join('')}
        </div>
      </section>
    `);
  }

  return sections.join('');
}

function parseEditorContent(input) {
  const blocks = String(input || '')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!blocks.length) {
    return [{ heading: 'Yangilik tafsilotlari', paragraphs: ['Maqola matni hali kiritilmagan.'] }];
  }
  return [
    {
      heading: 'Yangilik tafsilotlari',
      paragraphs: blocks,
    },
  ];
}

function serializeContentForEditor(article) {
  return article.sections
    .flatMap((section) => section.paragraphs || [])
    .join('\n\n');
}

function updateArticleFromInput(article, input) {
  article.title = String(input.title || article.title).trim();
  article.kicker = String(input.kicker || article.kicker || article.categoryLabel).trim();
  article.excerpt = String(input.excerpt || article.excerpt).trim();
  article.categorySlug = slugify(input.categorySlug || article.categorySlug) || article.categorySlug;
  article.categoryLabel = categoryLabel(article.categorySlug);
  article.tags = String(input.tags || article.tags.join(','))
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  article.seoTitle = String(input.seoTitle || article.seoTitle || article.title).trim();
  article.seoDescription = String(input.seoDescription || article.seoDescription || article.excerpt).trim();
  article.imageUrl = String(input.imageUrl || article.imageUrl || '').trim();
  article.imagePublicId = String(input.imagePublicId || article.imagePublicId || '').trim();
  article.sourceLinks = normalizeLinks(input.sourceLinks, article.sourceLinks || []);
  article.mediaAssets = mergeMediaInputs(input, article.mediaAssets || []);
  article.externalPosts = normalizeExternalPosts(input.externalPosts, article.externalPosts || []);
  article.sections = parseEditorContent(input.content || serializeContentForEditor(article));
  article.wordCount = sectionText(article).split(/\s+/).filter(Boolean).length;
  article.readingMinutes = minutesToRead(article.wordCount);
  article.updatedAt = new Date().toISOString();
  if (input.status) {
    article.status = normalizeArticleStatus(input.status, article.status || 'draft');
    if (article.status === 'published' && !article.publishedAt) {
      article.publishedAt = new Date().toISOString();
    }
  }
  if (typeof input.featured === 'boolean') {
    article.featured = input.featured;
  }
  return article;
}

async function submitIndexNow(urlList) {
  const body = {
    host: 'hallaym.com',
    key: store.integrations.indexNow.key,
    keyLocation: `${store.settings.siteUrl}/${store.integrations.indexNow.key}.txt`,
    urlList,
  };
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  store.integrations.indexNow.lastSubmission = {
    submittedAt: new Date().toISOString(),
    status: response.status,
    urls: urlList,
    body: text || 'OK',
  };
  store.integrations.indexNow.lastError = response.ok ? null : text || `HTTP ${response.status}`;
  if (!response.ok) {
    throw new Error(`Qidiruv platformasi javobi: ${response.status}`);
  }
  return store.integrations.indexNow.lastSubmission;
}

function apiConfig() {
  return {
    siteUrl: store.settings.siteUrl,
    brand: store.settings.brand,
    categories: categoryCatalog,
    demoMode: !runtimeState.mongo.connected,
    storage: {
      mongodb: {
        enabled: runtimeState.mongo.enabled,
        connected: runtimeState.mongo.connected,
        dbName: mongoConfig.dbName,
        error: runtimeState.mongo.error,
      },
      cloudinary: cloudinaryCapabilities(),
    },
    indexNow: {
      key: store.integrations.indexNow.key,
      lastSubmission: store.integrations.indexNow.lastSubmission,
    },
  };
}

function serveStaticRoute(res, filename) {
  try {
    const page = getStaticPage(filename);
    send(res, 200, page);
  } catch (error) {
    send(res, 404, 'Page not found', 'text/plain; charset=utf-8');
  }
}

function rssXml() {
  const items = getPublishedArticles()
    .slice(0, 25)
    .map((article) => {
      const author = getUserById(article.authorId);
      return `
        <item>
          <title>${escapeHtml(article.title)}</title>
          <link>${store.settings.siteUrl}/news/${article.slug}</link>
          <guid>${store.settings.siteUrl}/news/${article.slug}</guid>
          <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
          <description>${escapeHtml(article.excerpt)}</description>
          <author>${escapeHtml(author?.email || store.settings.brand.newsroomEmail)} (${escapeHtml(author?.name || 'Hallaym Team')})</author>
          <category>${escapeHtml(article.categoryLabel)}</category>
        </item>
      `;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>${escapeHtml(store.settings.brand.siteName)}</title>
      <link>${store.settings.siteUrl}</link>
      <description>${escapeHtml(store.settings.brand.heroDescription)}</description>
      <language>uz</language>
      ${items}
    </channel>
  </rss>`;
}

function sitemapXml() {
  const staticUrls = ['/', '/authors', '/about', '/contact', '/privacy', '/terms', '/search', '/login', '/register', '/apply'];
  const categoryUrls = categoryCatalog.map((category) => `/category/${category.slug}`);
  const authorUrls = store.users.filter((user) => user.role === 'author').map((user) => `/author/${user.slug}`);
  const articleUrls = getPublishedArticles().map((article) => `/news/${article.slug}`);
  const urls = [...staticUrls, ...categoryUrls, ...authorUrls, ...articleUrls];
  return `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls
      .map((url) => `<url><loc>${store.settings.siteUrl}${url}</loc><lastmod>${new Date().toISOString()}</lastmod></url>`)
      .join('')}
  </urlset>`;
}

function newsSitemapXml() {
  const freshArticles = getPublishedArticles().filter((article) => Date.now() - new Date(article.publishedAt).getTime() <= 48 * 60 * 60 * 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    ${freshArticles
      .map((article) => `
        <url>
          <loc>${store.settings.siteUrl}/news/${article.slug}</loc>
          <news:news>
            <news:publication>
              <news:name>${escapeHtml(store.settings.brand.siteName)}</news:name>
              <news:language>uz</news:language>
            </news:publication>
            <news:publication_date>${article.publishedAt}</news:publication_date>
            <news:title>${escapeHtml(article.title)}</news:title>
          </news:news>
        </url>
      `)
      .join('')}
  </urlset>`;
}

function robotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${store.settings.siteUrl}/sitemap.xml
Sitemap: ${store.settings.siteUrl}/news-sitemap.xml
`;
}

function manifestJson() {
  return JSON.stringify({
    name: store.settings.brand.siteName,
    short_name: store.settings.brand.shortName,
    description: store.settings.brand.heroDescription,
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f1e7',
    theme_color: '#c97022',
    icons: [
      {
        src: '/media/logo.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  });
}

function serviceWorkerScript() {
  return `
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  const url = event.notification?.data?.url || '/';
  event.notification.close();
  event.waitUntil(clients.openWindow(url));
});
`;
}

async function handleApi(req, res, url, visitorId) {
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/config') {
    sendJson(res, 200, apiConfig());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/session') {
    const user = currentUserFromRequest(req);
    sendJson(res, 200, { user: publicUser(user) });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/media/config') {
    sendJson(res, 200, cloudinaryCapabilities());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/media/sign-upload') {
    const user = requireRole(req, res, ['author', 'admin']);
    if (!user) {
      return true;
    }
    const caps = cloudinaryCapabilities();
    if (!caps.enabled || !caps.signed) {
      sendJson(res, 400, { error: 'Rasm yuklash xizmati sozlanmagan.' });
      return true;
    }
    const body = await readBody(req);
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = slugify(body.publicId || `${user.slug}-${Date.now()}`);
    const params = {
      folder: caps.folder,
      public_id: publicId,
      timestamp,
    };
    const signature = signCloudinaryParams(params);
    sendJson(res, 200, {
      cloudName: caps.cloudName,
      apiKey: cloudinaryConfig.apiKey,
      timestamp,
      signature,
      folder: caps.folder,
      publicId,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/articles') {
    const search = String(url.searchParams.get('search') || '').toLowerCase().trim();
    const category = String(url.searchParams.get('category') || '').trim();
    const authorSlug = String(url.searchParams.get('author') || '').trim();
    let list = getPublishedArticles();
    if (category) {
      list = list.filter((article) => article.categorySlug === category);
    }
    if (authorSlug) {
      const author = store.users.find((user) => user.slug === authorSlug);
      list = list.filter((article) => article.authorId === author?.id);
    }
    if (search) {
      list = list.filter((article) => {
        const haystack = `${article.title} ${article.excerpt} ${article.tags.join(' ')} ${sectionText(article)}`.toLowerCase();
        return haystack.includes(search);
      });
    }
    sendJson(res, 200, { items: list.map(articleToSummary) });
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/articles/')) {
    const slug = pathname.split('/').pop();
    const article = findArticleBySlug(slug);
    if (!article || article.status !== 'published') {
      sendJson(res, 404, { error: 'Maqola topilmadi.' });
      return true;
    }
    sendJson(res, 200, {
      item: articleToDetail(article),
      recommendations: relatedArticles(article).map(articleToSummary),
      readiness: publisherReadiness(article),
    });
    return true;
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/articles\/[^/]+\/like$/)) {
    const slug = pathname.split('/')[3];
    const article = findArticleBySlug(slug);
    if (!article || article.status !== 'published') {
      sendJson(res, 404, { error: 'Maqola topilmadi.' });
      return true;
    }
    if (!store.reactions.has(article.id)) {
      store.reactions.set(article.id, new Set());
    }
    const visitors = store.reactions.get(article.id);
    if (!visitors.has(visitorId)) {
      visitors.add(visitorId);
      article.likes += 1;
      scheduleArticlesPersist();
    }
    sendJson(res, 200, { likes: article.likes });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/subscribe') {
    const body = await readBody(req);
    const target = String(body.target || body.email || 'browser').trim();
    const type = String(body.type || 'email').trim();
    const exists = store.subscribers.find((item) => item.target === target && item.type === type);
    if (!exists) {
      store.subscribers.push({
        id: randomId('subscriber'),
        target,
        type,
        createdAt: new Date().toISOString(),
      });
      await persistSubscribers();
    }
    sendJson(res, 201, { ok: true, total: store.subscribers.length });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/alerts') {
    const since = Number(url.searchParams.get('since') || 0);
    const items = getPublishedArticles()
      .filter((article) => new Date(article.updatedAt).getTime() > since)
      .slice(0, 5)
      .map((article) => ({
        title: article.title,
        excerpt: article.excerpt,
        url: `/news/${article.slug}`,
        imageUrl: articleImageUrl(article),
        updatedAt: new Date(article.updatedAt).getTime(),
      }));
    const latest = items.length ? Math.max(...items.map((item) => item.updatedAt)) : since;
    sendJson(res, 200, { items, latest });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = store.users.find((candidate) => candidate.email.toLowerCase() === email);
    if (!user || user.passwordHash !== hashPassword(password)) {
      sendJson(res, 401, { error: 'Email yoki parol noto\'g\'ri.' });
      return true;
    }
    const token = crypto.randomUUID();
    store.sessions.set(token, { userId: user.id, createdAt: new Date().toISOString() });
    appendSetCookie(res, cookieString(SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 14 }));
    sendJson(res, 200, { user: publicUser(user) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name || !email || password.length < 6) {
      sendJson(res, 400, { error: 'Ism, email va kamida 6 belgili parol kiriting.' });
      return true;
    }
    if (!body.acceptLegal) {
      sendJson(res, 400, { error: 'Maxfiylik siyosati va foydalanish shartlariga rozilik majburiy.' });
      return true;
    }
    if (store.users.some((candidate) => candidate.email.toLowerCase() === email)) {
      sendJson(res, 409, { error: 'Bu email allaqachon ro\'yxatdan o\'tgan.' });
      return true;
    }
    const user = {
      id: randomId('user'),
      slug: slugify(name),
      name,
      email,
      passwordHash: hashPassword(password),
      role: 'user',
      title: 'Subscriber',
      bio: 'Hallaym Newsroom foydalanuvchisi.',
      joinedAt: new Date().toISOString(),
    };
    store.users.push(user);
    await persistUsers();
    const token = crypto.randomUUID();
    store.sessions.set(token, { userId: user.id, createdAt: new Date().toISOString() });
    appendSetCookie(res, cookieString(SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 14 }));
    sendJson(res, 201, { user: publicUser(user) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      store.sessions.delete(token);
    }
    appendSetCookie(res, cookieString(SESSION_COOKIE, '', { maxAge: 0 }));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/author-applications') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const expertise = String(body.expertise || '').trim();
    const pitch = String(body.pitch || '').trim();
    if (!name || !email || !expertise || !pitch) {
      sendJson(res, 400, { error: 'Barcha maydonlarni to\'ldiring.' });
      return true;
    }
    store.authorApplications.unshift({
      id: randomId('application'),
      name,
      email,
      expertise,
      pitch,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    await persistApplications();
    sendJson(res, 201, { ok: true });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    sendJson(res, 200, {
      stats: analyticsSnapshot(),
      indexNow: store.integrations.indexNow,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/admin/articles') {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    sendJson(res, 200, {
      items: store.articles
        .slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map((article) => ({
          ...articleToDetail(article),
          content: serializeContentForEditor(article),
        })),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/admin/feed-health') {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    sendJson(res, 200, {
      items: store.articles.map((article) => ({
        article: articleToSummary(article),
        readiness: publisherReadiness(article),
      })),
      note:
        'Google Search Central va Yahoo/Bing ko\'rsatmalariga mos ichki readiness ko\'rsatiladi. Real appearance Search Console va Bing Webmaster orqali tasdiqlanadi.',
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/admin/applications') {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    sendJson(res, 200, { items: store.authorApplications });
    return true;
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/applications\/[^/]+\/approve$/)) {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    const applicationId = pathname.split('/')[4];
    const application = store.authorApplications.find((item) => item.id === applicationId);
    if (!application) {
      sendJson(res, 404, { error: 'Ariza topilmadi.' });
      return true;
    }
    application.status = 'approved';
    let account = store.users.find((candidate) => candidate.email.toLowerCase() === application.email.toLowerCase());
    if (!account) {
      account = {
        id: randomId('user'),
        slug: slugify(application.name),
        name: application.name,
        email: application.email,
        passwordHash: hashPassword('Author#2026'),
        role: 'author',
        title: application.expertise,
        bio: application.pitch,
        joinedAt: new Date().toISOString(),
      };
      store.users.push(account);
    } else {
      account.role = 'author';
      account.title = application.expertise;
      account.bio = application.pitch;
    }
    await Promise.all([persistApplications(), persistUsers()]);
    sendJson(res, 200, { ok: true, author: publicUser(account) });
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/admin/settings') {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    const body = await readBody(req);
    Object.assign(store.settings.brand, {
      siteName: String(body.siteName || store.settings.brand.siteName).trim(),
      shortName: String(body.shortName || store.settings.brand.shortName).trim(),
      accent: String(body.accent || store.settings.brand.accent).trim(),
      logoUrl: String(body.logoUrl || store.settings.brand.logoUrl || '').trim(),
      logoPublicId: String(body.logoPublicId || store.settings.brand.logoPublicId || '').trim(),
      tagline: String(body.tagline || store.settings.brand.tagline).trim(),
      announcement: String(body.announcement || store.settings.brand.announcement).trim(),
      heroTitle: String(body.heroTitle || store.settings.brand.heroTitle).trim(),
      heroDescription: String(body.heroDescription || store.settings.brand.heroDescription).trim(),
      ownerName: String(body.ownerName || store.settings.brand.ownerName).trim(),
      newsroomEmail: String(body.newsroomEmail || store.settings.brand.newsroomEmail).trim(),
      phone: String(body.phone || store.settings.brand.phone).trim(),
      address: String(body.address || store.settings.brand.address).trim(),
      footerAbout: String(body.footerAbout || store.settings.brand.footerAbout).trim(),
      telegram: String(body.telegram || store.settings.brand.telegram).trim(),
      youtube: String(body.youtube || store.settings.brand.youtube).trim(),
      instagram: String(body.instagram || store.settings.brand.instagram).trim(),
      x: String(body.x || store.settings.brand.x).trim(),
    });
    await persistSettings();
    sendJson(res, 200, { ok: true, config: apiConfig() });
    return true;
  }

  if (req.method === 'PUT' && pathname.match(/^\/api\/admin\/articles\/[^/]+$/)) {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    const articleId = pathname.split('/')[4];
    const article = findArticleById(articleId);
    if (!article) {
      sendJson(res, 404, { error: 'Post topilmadi.' });
      return true;
    }
    const body = await readBody(req);
    updateArticleFromInput(article, body);
    await persistArticles();
    sendJson(res, 200, { item: articleToDetail(article) });
    return true;
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/admin\/articles\/[^/]+$/)) {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    const articleId = pathname.split('/')[4];
    const index = store.articles.findIndex((article) => article.id === articleId);
    if (index === -1) {
      sendJson(res, 404, { error: 'Post topilmadi.' });
      return true;
    }
    store.articles.splice(index, 1);
    await persistArticles();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/admin/indexnow') {
    const user = requireRole(req, res, ['admin']);
    if (!user) {
      return true;
    }
    try {
      const payload = await submitIndexNow(getPublishedArticles().slice(0, 20).map((article) => `${store.settings.siteUrl}/news/${article.slug}`));
      sendJson(res, 200, { ok: true, submission: payload });
    } catch (error) {
      sendJson(res, 502, { error: error.message, integration: store.integrations.indexNow });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/writer/dashboard') {
    const user = requireRole(req, res, ['author', 'admin']);
    if (!user) {
      return true;
    }
    const items = user.role === 'admin' ? store.articles : authorArticles(user.id);
    sendJson(res, 200, {
      user: publicUser(user),
      items: items.map((article) => ({
        ...articleToDetail(article),
        content: serializeContentForEditor(article),
      })),
    });
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/writer/profile') {
    const user = requireRole(req, res, ['author', 'admin']);
    if (!user) {
      return true;
    }
    const body = await readBody(req);
    user.name = String(body.name || user.name).trim();
    user.title = String(body.title || user.title).trim();
    user.bio = String(body.bio || user.bio).trim();
    await persistUsers();
    sendJson(res, 200, { user: publicUser(user) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/writer/articles') {
    const user = requireRole(req, res, ['author', 'admin']);
    if (!user) {
      return true;
    }
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    const excerpt = String(body.excerpt || '').trim();
    if (!title || !excerpt) {
      sendJson(res, 400, { error: 'Sarlavha va qisqa tavsif majburiy.' });
      return true;
    }
    const article = makeArticle({
      id: randomId('article'),
      slug: `${slugify(title)}-${crypto.randomBytes(2).toString('hex')}`,
      title,
      kicker: String(body.kicker || 'Writer draft').trim(),
      excerpt,
      categorySlug: slugify(body.categorySlug || 'technology'),
      authorId: user.id,
      featured: false,
      hoursAgo: 1,
      updatedHoursAgo: 1,
      tags: String(body.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      seoTitle: String(body.seoTitle || title).trim(),
      seoDescription: String(body.seoDescription || excerpt).trim(),
      sections: parseEditorContent(body.content || ''),
      status: user.role === 'admin' ? normalizeArticleStatus(body.status, 'draft') : (body.status === 'draft' ? 'draft' : 'pending_review'),
      imageUrl: String(body.imageUrl || '').trim(),
      imagePublicId: String(body.imagePublicId || '').trim(),
      sourceLinks: normalizeLinks(body.sourceLinks || []),
      mediaAssets: mergeMediaInputs(body, []),
      externalPosts: normalizeExternalPosts(body.externalPosts || []),
      views: 0,
      likes: 0,
    });
    store.articles.unshift(article);
    await persistArticles();
    sendJson(res, 201, { item: articleToDetail(article) });
    return true;
  }

  if (req.method === 'PUT' && pathname.match(/^\/api\/writer\/articles\/[^/]+$/)) {
    const user = requireRole(req, res, ['author', 'admin']);
    if (!user) {
      return true;
    }
    const articleId = pathname.split('/')[4];
    const article = findArticleById(articleId);
    if (!article || (user.role !== 'admin' && article.authorId !== user.id)) {
      sendJson(res, 404, { error: 'Post topilmadi.' });
      return true;
    }
    const body = await readBody(req);
    updateArticleFromInput(article, body);
    if (user.role !== 'admin') {
      article.status = body.status === 'draft' ? 'draft' : 'pending_review';
    }
    await persistArticles();
    sendJson(res, 200, { item: articleToDetail(article) });
    return true;
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/writer\/articles\/[^/]+$/)) {
    const user = requireRole(req, res, ['author', 'admin']);
    if (!user) {
      return true;
    }
    const articleId = pathname.split('/')[4];
    const index = store.articles.findIndex(
      (article) => article.id === articleId && (user.role === 'admin' || article.authorId === user.id),
    );
    if (index === -1) {
      sendJson(res, 404, { error: 'Post topilmadi.' });
      return true;
    }
    store.articles.splice(index, 1);
    await persistArticles();
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const visitorId = ensureVisitor(req, res);
    const user = currentUserFromRequest(req);

    if (pathname === '/assets/site.css') {
      send(res, 200, siteCss, 'text/css; charset=utf-8', { 'Cache-Control': 'no-cache' });
      return;
    }

    if (pathname === '/assets/site.js') {
      send(res, 200, siteJs, 'application/javascript; charset=utf-8', { 'Cache-Control': 'no-cache' });
      return;
    }

    if (pathname === '/service-worker.js') {
      send(res, 200, serviceWorkerScript(), 'application/javascript; charset=utf-8');
      return;
    }

    if (pathname === '/manifest.webmanifest') {
      send(res, 200, manifestJson(), 'application/manifest+json; charset=utf-8');
      return;
    }

    if (pathname === '/privacy.pdf' || pathname === '/terms.pdf') {
      const type = pathname.includes('privacy') ? 'privacy' : 'terms';
      send(res, 200, makeLegalPdf(type), 'application/pdf', { 'Content-Disposition': `inline; filename="${type}.pdf"` });
      return;
    }

    if (pathname === '/robots.txt') {
      send(res, 200, robotsTxt(), 'text/plain; charset=utf-8');
      return;
    }

    if (pathname === '/sitemap.xml') {
      send(res, 200, sitemapXml(), 'application/xml; charset=utf-8');
      return;
    }

    if (pathname === '/news-sitemap.xml') {
      send(res, 200, newsSitemapXml(), 'application/xml; charset=utf-8');
      return;
    }

    if (pathname === '/rss.xml') {
      send(res, 200, rssXml(), 'application/xml; charset=utf-8');
      return;
    }

    if (pathname === `/${store.integrations.indexNow.key}.txt`) {
      send(res, 200, store.integrations.indexNow.key, 'text/plain; charset=utf-8');
      return;
    }

    if (pathname === '/favicon.svg' || pathname === '/media/logo.svg') {
      send(res, 200, renderLogoSvg(), 'image/svg+xml; charset=utf-8');
      return;
    }

    if (pathname.startsWith('/media/article/')) {
      const slug = pathname.replace('/media/article/', '').replace(/\.svg$/, '');
      const article = findArticleBySlug(slug);
      if (!article) {
        send(res, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }
      send(res, 200, renderArticleSvg(article), 'image/svg+xml; charset=utf-8');
      return;
    }

    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url, visitorId);
      if (!handled) {
        sendJson(res, 404, { error: 'So‘ralgan sahifa topilmadi.' });
      }
      return;
    }

    if (pathname === '/admin' && (!user || user.role !== 'admin')) {
      redirect(res, '/login?next=/admin');
      return;
    }

    if (pathname === '/writer' && (!user || !['author', 'admin'].includes(user.role))) {
      redirect(res, '/login?next=/writer');
      return;
    }

    const staticRoutes = {
      '/landing': 'index.html',
      '/login': 'login.html',
      '/register': 'register.html',
      '/apply': 'apply.html',
      '/admin': 'admin.html',
      '/writer': 'writer.html',
      '/search': 'search.html',
    };

    if (staticRoutes[pathname]) {
      serveStaticRoute(res, staticRoutes[pathname]);
      return;
    }

    if (pathname === '/') {
      send(res, 200, renderHomePage(user));
      return;
    }

    if (pathname === '/authors') {
      send(res, 200, renderAuthorsPage(user));
      return;
    }

    if (pathname === '/about') {
      send(res, 200, renderAboutPage(user));
      return;
    }

    if (pathname === '/contact') {
      send(res, 200, renderContactPage(user));
      return;
    }

    if (pathname === '/privacy') {
      send(res, 200, renderSimplePolicyPage('privacy', user));
      return;
    }

    if (pathname === '/terms') {
      send(res, 200, renderSimplePolicyPage('terms', user));
      return;
    }

    if (pathname.startsWith('/category/')) {
      const slug = pathname.replace('/category/', '');
      const page = renderCategoryPage(slug, user);
      if (page) {
        send(res, 200, page);
        return;
      }
    }

    if (pathname.startsWith('/author/')) {
      const slug = pathname.replace('/author/', '');
      const page = renderAuthorPage(slug, user);
      if (page) {
        send(res, 200, page);
        return;
      }
    }

    if (pathname.startsWith('/news/')) {
      const slug = pathname.replace('/news/', '');
      const article = findArticleBySlug(slug);
      if (article && article.status === 'published') {
        article.views += 1;
        scheduleArticlesPersist();
        send(res, 200, renderArticlePage(article, user));
        return;
      }
    }

    send(res, 404, renderNotFound(user));
  } catch (error) {
    console.error(error);
    send(res, 500, `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px"><h1>500</h1><p>${escapeHtml(error.message)}</p></body></html>`);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} band. CMD: set PORT=3011 && node server.js | PowerShell: $env:PORT='3011'; node server.js`);
    process.exit(1);
  }
  console.error('Server error:', error);
  process.exit(1);
});

async function start() {
  await initMongo();
  server.listen(PORT, HOST, () => {
    console.log(`Hallaym Newsroom running at http://localhost:${PORT}`);
    if (runtimeState.mongo.connected) {
      console.log(`MongoDB connected: ${mongoConfig.dbName}`);
    } else if (runtimeState.mongo.enabled) {
      console.log(`MongoDB fallback mode: ${runtimeState.mongo.error}`);
    } else {
      console.log('MongoDB env topilmadi, demo fallback mode ishlayapti.');
    }
    if (runtimeState.cloudinary.enabled) {
      console.log(`Cloudinary enabled: ${cloudinaryConfig.cloudName}`);
    } else {
      console.log('Cloudinary env topilmadi, SVG fallback cover ishlayapti.');
    }
  });
}

start().catch((error) => {
  console.error('Startup error:', error);
  process.exit(1);
});
