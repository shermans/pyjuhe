"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = require("axios");
const he = require("he");
const pageSize = 30;

// ============ 怡红院 · 沉音 ============
// 由 lx-music 音源脚本移植，解析接口来自原脚本
// API: https://musicserver.haitangw.cc/v1/ (主) / https://qt.haitangw.net/v1/ (备)
// 搜索/榜单/歌单数据来自酷我公开接口

const API1 = "https://musicserver.haitangw.cc/v1/";
const API2 = "https://qt.haitangw.net/v1/";
const CACHE_TTL = 20 * 60 * 1000; // 缓存20分钟

const QUALITY_MAP = {
  low: "128k",
  standard: "320k",
  high: "flac",
  super: "flac",
};

// 落雪源支持的音质级别映射（实测可用）
const API_QUALITY_MAP = {
  "128k": "standard",
  "320k": "exhigh",
  flac: "lossless",
};

const urlCache = new Map();

function artworkShort2Long(albumpicShort) {
  var _a;
  const firstSlashOfAlbum =
    (_a =
      albumpicShort === null || albumpicShort === void 0
        ? void 0
        : albumpicShort.indexOf("/")) !== null && _a !== void 0
      ? _a
      : -1;
  return firstSlashOfAlbum !== -1
    ? `https://img4.kuwo.cn/star/albumcover/1080${albumpicShort.slice(
        firstSlashOfAlbum
      )}`
    : undefined;
}

function formatMusicItem(_) {
  return {
    id: _.MUSICRID.replace("MUSIC_", ""),
    artwork: artworkShort2Long(_.web_albumpic_short),
    title: he.decode(_.NAME || ""),
    artist: he.decode(_.ARTIST || ""),
    album: he.decode(_.ALBUM || ""),
    albumId: _.ALBUMID,
    artistId: _.ARTISTID,
    // 保存原始平台信息，供解析接口使用
    _source: "kw",
  };
}

// 榜单歌曲格式化（bang/musicList 接口字段）
function formatBangItem(_) {
  const rid = (_.musicrid || "").replace("MUSIC_", "") || String(_.rid || "");
  return {
    id: rid,
    artwork: _.pic || undefined,
    title: he.decode(_.name || ""),
    artist: he.decode(_.artist || ""),
    album: he.decode(_.album || ""),
    albumId: _.albumid,
    _source: "kw",
  };
}

// 歌单歌曲格式化（pl.svc 接口字段）
function formatSheetSong(_) {
  return {
    id: String(_.id || ""),
    title: he.decode(_.name || ""),
    artist: he.decode(_.artist || ""),
    album: he.decode(_.album || ""),
    albumId: _.albumid,
    artistId: _.artistid,
    _source: "kw",
  };
}

async function searchMusic(query, page) {
  const res = (
    await (0, axios_1.default)({
      method: "get",
      url: `http://search.kuwo.cn/r.s`,
      params: {
        client: "kt",
        all: query,
        pn: page - 1,
        rn: pageSize,
        uid: 2574109560,
        ver: "kwplayer_ar_8.5.4.2",
        vipver: 1,
        ft: "music",
        cluster: 0,
        strategy: 2012,
        encoding: "utf8",
        rformat: "json",
        vermerge: 1,
        mobi: 1,
      },
    })
  ).data;
  const songs = res.abslist.map(formatMusicItem);
  return {
    isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL,
    data: songs,
  };
}

// ============ 最新热榜 ============
async function getTopLists() {
  const res = (
    await (0, axios_1.default)({
      method: "get",
      url: "http://wapi.kuwo.cn/api/www/bang/bang/bangMenu",
      timeout: 30000,
    })
  ).data;
  if (res.code !== 200 || !res.data) return [];
  // data 为分组数组: [{name:"官方", list:[{id,name,pic,intro,pub}]}]
  return res.data.map((group) => ({
    title: group.name,
    data: (group.list || []).map((_) => ({
      // 注意: musicList 详情接口要用 sourceid，不是 id
      id: _.sourceid,
      title: _.name,
      coverImg: _.pic,
      description: `${_.pub || ""} ${_.intro || ""}`.trim(),
    })),
  }));
}

async function getTopListDetail(topListItem, page) {
  const res = (
    await (0, axios_1.default)({
      method: "get",
      url: "http://wapi.kuwo.cn/api/www/bang/bang/musicList",
      params: { bangId: topListItem.id, pn: page, rn: pageSize },
      timeout: 30000,
    })
  ).data;
  if (res.code !== 200 || !res.data) return { isEnd: true, data: [] };
  const list = res.data.musicList || [];
  const total = +res.data.num || 0;
  return {
    isEnd: page * pageSize >= total || list.length < pageSize,
    data: list.map(formatBangItem),
  };
}

// ============ 精选歌单 ============
const SHEET_TAGS = [
  { id: "hot", title: "最热" },
  { id: "new", title: "最新" },
];

async function getRecommendSheetTags() {
  return { data: SHEET_TAGS };
}

async function getRecommendSheetsByTag(tag, page) {
  const order = tag.id === "new" ? "new" : "hot";
  const res = (
    await (0, axios_1.default)({
      method: "get",
      url: "http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList",
      params: {
        loginUid: 0,
        loginSid: 0,
        appUid: 76039576,
        pn: page,
        rn: pageSize,
        order: order,
      },
      timeout: 30000,
    })
  ).data;
  if (res.code !== 200 || !res.data) return { isEnd: true, data: [] };
  const list = res.data.data || [];
  const total = +res.data.total || 0;
  return {
    isEnd: page * pageSize >= total || list.length < pageSize,
    data: list.map((_) => ({
      id: _.id,
      title: he.decode(_.name || ""),
      coverImg: _.img,
      artist: _.uname || "",
      playCount: +_.listencnt || 0,
      worksNum: +_.total || 0,
      description: _.info || _.digest || "",
    })),
  };
}

async function getMusicSheetInfo(sheet, page) {
  const rn = pageSize;
  const pn = (page - 1) * rn;
  const res = (
    await (0, axios_1.default)({
      method: "get",
      url: "http://nplserver.kuwo.cn/pl.svc",
      params: {
        op: "getlistinfo",
        pid: sheet.id,
        pn: pn,
        rn: rn,
        encode: "utf8",
        keyset: "pl2012",
        identity: "kuwo",
        pcmp4: 1,
        isnew: 1,
        vipver: 1,
      },
      timeout: 30000,
    })
  ).data;
  const list = res.musiclist || [];
  const total = +res.total || 0;
  return {
    isEnd: pn + rn >= total || list.length < rn,
    musicList: list.map(formatSheetSong),
  };
}

async function resolveUrl(apiBase, source, rid, level) {
  const res = await (0, axios_1.default)({
    method: "post",
    url: `${apiBase}music/resolve-url`,
    headers: { "Content-Type": "application/json" },
    data: { source, rid: String(rid), level },
    timeout: 8000,
  });
  const body = res.data;
  if (body && body.data && body.data.url) return body.data.url;
  if (body && body.url) return body.url;
  throw new Error(body.message || "解析失败");
}

async function getMediaSource(musicItem, quality) {
  const userQuality = QUALITY_MAP[quality] || "320k";
  const apiLevel = API_QUALITY_MAP[userQuality] || "320k";
  const rid = musicItem.id;
  const source = musicItem._source || "kw";
  const cacheKey = `${source}-${rid}-${apiLevel}`;
  const cached = urlCache.get(cacheKey);

  // 缓存命中且未过期
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return { url: cached.url };
  }

  // 主线路 -> 备用线路
  let lastErr;
  for (const api of [API1, API2]) {
    try {
      const url = await resolveUrl(api, source, rid, apiLevel);
      urlCache.set(cacheKey, { url, time: Date.now() });
      return { url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("所有线路解析失败");
}

async function getLyric(musicItem) {
  const res = (
    await (0, axios_1.default)({
      method: "get",
      url: `http://m.kuwo.cn/newh5/singles/songinfoandlrc`,
      params: { musicId: musicItem.id },
    })
  ).data;
  if (res.status === 200 && res.data && res.data.lrclist) {
    return {
      rawLrc: res.data.lrclist.map((_) => `[${_.time}]${_.lineLyric}`).join("\n"),
    };
  }
  return { rawLrc: "" };
}

module.exports = {
  platform: "怡红院 · 沉音",
  version: "26.10.18-fix",
  appVersion: ">0.1.0-alpha.0",
  srcUrl: "",
  cacheControl: "no-cache",
  hints: {
    importMusicSheet: [],
  },
  supportedSearchType: ["music"],
  async search(query, page, type) {
    if (type === "music") return await searchMusic(query, page);
  },
  // 最新热榜
  getTopLists,
  getTopListDetail,
  // 精选歌单
  getRecommendSheetTags,
  getRecommendSheetsByTag,
  getMusicSheetInfo,
  getMediaSource,
  getLyric,
};
