// tags.js — 自訂群組（標籤）：一個字可屬多個群組；標籤存在學習紀錄的 tags 陣列。
// 刪除群組只移除標籤，不刪單字本身。各使用者(profileId)獨立。

import {
  getTagsByProfile, putTag, deleteTagRecord,
  getRecordsByProfile, getRecord, putRecord, putRecords,
} from './db.js';
import { newRecord } from './srs.js';
import { getById } from './vocab.js';

export async function getTags(profileId) {
  const list = await getTagsByProfile(profileId);
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createTag(profileId, name) {
  const tag = { id: 'tag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), profileId, name: name.trim(), createdAt: Date.now() };
  await putTag(tag);
  return tag;
}

export async function renameTag(tag, name) {
  tag.name = name.trim();
  await putTag(tag);
}

// 刪除群組：移除標籤定義 + 從所有紀錄的 tags 移除該 id（不刪字）
export async function deleteTag(profileId, tagId) {
  const recs = await getRecordsByProfile(profileId);
  const changed = [];
  for (const r of recs) {
    if (r.tags && r.tags.includes(tagId)) {
      r.tags = r.tags.filter((t) => t !== tagId);
      changed.push(r);
    }
  }
  if (changed.length) await putRecords(changed);
  await deleteTagRecord(tagId);
}

// 確保某字有學習紀錄（加入群組時若無紀錄則建立 status:new）
async function ensureRecord(profile, wordId) {
  let rec = await getRecord(profile.id, wordId);
  if (!rec) {
    const e = getById(wordId);
    rec = newRecord(profile.id, wordId, e ? e.level : 0);
    await putRecord(rec);
  }
  return rec;
}

// 設定某字所屬群組（多選，覆蓋）
export async function setWordTags(profile, wordId, tagIds) {
  const rec = await ensureRecord(profile, wordId);
  rec.tags = [...new Set(tagIds)];
  rec.updatedAt = Date.now();
  await putRecord(rec);
}

// 把某字加入某群組（保留既有標籤）
export async function addWordToTag(profile, wordId, tagId) {
  const rec = await ensureRecord(profile, wordId);
  rec.tags = rec.tags || [];
  if (!rec.tags.includes(tagId)) rec.tags.push(tagId);
  rec.updatedAt = Date.now();
  await putRecord(rec);
}

// 批次把多個字加入某群組
export async function addWordsToTag(profile, wordIds, tagId) {
  for (const id of wordIds) await addWordToTag(profile, id, tagId);
}

// 取某群組的所有字（wordIds）
export async function wordsInTag(profileId, tagId) {
  const recs = await getRecordsByProfile(profileId);
  return recs.filter((r) => r.tags && r.tags.includes(tagId)).map((r) => r.wordId);
}

// 取某字的群組 id 陣列
export async function tagsOfWord(profile, wordId) {
  const rec = await getRecord(profile.id, wordId);
  return (rec && rec.tags) ? rec.tags : [];
}

// 計算各群組的字數
export async function tagCounts(profileId) {
  const recs = await getRecordsByProfile(profileId);
  const counts = {};
  for (const r of recs) {
    for (const t of r.tags || []) counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}
