/**
 * 초안(drafts/*.md)을 읽어 번역한 뒤, 언어별 기사 파일에 추가합니다.
 *
 * 동작 순서
 *  1. drafts 폴더에서 published가 false인 초안을 모두 찾습니다.
 *  2. 각 초안의 제목·본문을 영어·일본어·중국어로 번역합니다.
 *     (data/glossary.json의 고유명사 용어집을 함께 전달합니다)
 *  3. data/news.ko.json / news.en.json / news.ja.json / news.zh.json 에
 *     각각 새 항목을 맨 앞에 추가합니다. 사진 경로도 함께 넣습니다.
 *  4. 처리한 초안은 published: true 로 바꿔 다시 저장합니다.
 *
 * 이 스크립트는 GitHub Actions 안에서만 실행되며,
 * API 키는 저장소 Secrets(OPENAI_API_KEY)에서 읽습니다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, 'drafts');
const DATA_DIR = path.join(ROOT, 'data');
const GLOSSARY_PATH = path.join(DATA_DIR, 'glossary.json');

const TARGET_LANGS = [
  { code: 'en', label: '영어 (English)' },
  { code: 'ja', label: '일본어 (Japanese)' },
  { code: 'zh', label: '중국어 간체 (Simplified Chinese)' },
];

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/* ---------- 파일 읽기/쓰기 도우미 ---------- */

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * 날짜를 YYYY-MM-DD 형태의 문자열로 통일합니다.
 * YAML은 따옴표 없는 2026-08-06 을 날짜 객체로 읽기 때문에 변환이 필요합니다.
 */
function toDateString(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** 마크다운 파일에서 앞머리(frontmatter)와 본문을 분리합니다. */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: text.trim() };
  return { data: yaml.load(match[1]) || {}, body: match[2].trim() };
}

/** 앞머리와 본문을 다시 하나의 마크다운 문자열로 합칩니다. */
function buildFrontmatter(data, body) {
  const head = yaml.dump(data, { lineWidth: -1 }).trimEnd();
  return `---\n${head}\n---\n\n${body}\n`;
}

/* ---------- 번역 ---------- */

function glossaryTable(terms) {
  if (!terms.length) return '(없음)';
  return terms
    .map((t) => `- ${t.ko} → EN: ${t.en || '-'} / JA: ${t.ja || '-'} / ZH: ${t.zh || '-'}`)
    .join('\n');
}

async function translate({ title, body, langLabel, langCode, terms }) {
  const system = [
    '당신은 구조 엔지니어링 회사의 보도자료를 번역하는 전문 번역가입니다.',
    `한국어 원문을 ${langLabel}로 번역하세요.`,
    '',
    '규칙:',
    '- 아래 용어집에 있는 고유명사는 반드시 지정된 표기를 사용하세요.',
    '- 원문의 문단 구분을 그대로 유지하세요.',
    '- 설명이나 머리말을 덧붙이지 말고, 아래 JSON 형식으로만 답하세요.',
    '',
    '용어집:',
    glossaryTable(terms),
    '',
    '출력 형식 (JSON, 다른 텍스트 없이):',
    '{"title": "번역된 제목", "body": "번역된 본문"}',
  ].join('\n');

  const user = `제목: ${title}\n\n본문:\n${body}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`번역 API 오류 (${langCode}, ${res.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`번역 응답이 비어 있습니다 (${langCode})`);

  const parsed = JSON.parse(content);
  if (!parsed.title || !parsed.body) {
    throw new Error(`번역 결과에 제목 또는 본문이 없습니다 (${langCode})`);
  }
  return parsed;
}

/* ---------- 메인 ---------- */

async function main() {
  if (!API_KEY) {
    throw new Error(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. ' +
        '저장소 Settings → Secrets and variables → Actions 에서 등록해주세요.'
    );
  }

  let files = [];
  try {
    files = (await fs.readdir(DRAFTS_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    console.log('drafts 폴더가 없습니다. 할 일이 없습니다.');
    return;
  }

  const glossary = await readJson(GLOSSARY_PATH, []);
  const terms = Array.isArray(glossary) ? glossary : [];

  // 언어별 기사 목록을 미리 읽어둡니다.
  const news = {};
  for (const code of ['ko', ...TARGET_LANGS.map((l) => l.code)]) {
    const list = await readJson(path.join(DATA_DIR, `news.${code}.json`), []);
    news[code] = Array.isArray(list) ? list : [];
  }

  let publishedCount = 0;

  for (const file of files.sort()) {
    const fullPath = path.join(DRAFTS_DIR, file);
    const raw = await fs.readFile(fullPath, 'utf8');
    const { data, body } = parseFrontmatter(raw);

    if (data.published === true) continue; // 이미 게시된 초안은 건너뜁니다.

    const title = (data.title || '').trim();
    if (!title || !body) {
      console.log(`건너뜀 (제목 또는 본문 없음): ${file}`);
      continue;
    }

    const date = toDateString(data.date);
    const tag = data.tag || 'PRESS';
    const image = data.image || '';
    data.date = date; // 초안 파일에도 깔끔한 문자열로 다시 저장합니다.

    console.log(`처리 중: ${file} — ${title}`);

    // 1) 한국어 원문을 그대로 추가
    news.ko.unshift({ title, date, tag, lang: 'ko', image, body });

    // 2) 나머지 언어는 번역해서 추가
    for (const lang of TARGET_LANGS) {
      const out = await translate({
        title,
        body,
        langLabel: lang.label,
        langCode: lang.code,
        terms,
      });
      news[lang.code].unshift({
        title: out.title,
        date,
        tag,
        lang: lang.code,
        image,
        body: out.body,
      });
      console.log(`  ${lang.code} 번역 완료`);
    }

    // 3) 초안을 게시 완료로 표시
    data.published = true;
    await fs.writeFile(fullPath, buildFrontmatter(data, body), 'utf8');
    publishedCount += 1;
  }

  if (publishedCount === 0) {
    console.log('새로 게시할 초안이 없습니다.');
    return;
  }

  for (const [code, list] of Object.entries(news)) {
    await writeJson(path.join(DATA_DIR, `news.${code}.json`), list);
  }

  console.log(`총 ${publishedCount}건을 게시했습니다.`);
}

main().catch((err) => {
  console.error('실패:', err.message);
  process.exit(1);
});
