const values = (source, pattern) => [...String(source ?? "").matchAll(pattern)]
  .map(([, value]) => value.trim())
  .filter(Boolean);

const unique = (valuesToMerge) => [...new Set(valuesToMerge.flat())];

const characterRecord = ([, block]) => {
  const literal = values(block, /<literal>([^<]+)<\/literal>/gu)[0] ?? "";
  const meanings = [...block.matchAll(/<meaning(?<attributes>\s[^>]*)?>(?<value>[^<]+)<\/meaning>/gu)]
    .filter(({ groups }) => !groups.attributes?.includes("m_lang"))
    .map(({ groups }) => groups.value.trim())
    .filter(Boolean);
  const onReadings = values(block, /<reading r_type="ja_on">([^<]+)<\/reading>/gu);
  const kunReadings = values(block, /<reading r_type="ja_kun">([^<]+)<\/reading>/gu);
  const nanoriReadings = values(block, /<nanori>([^<]+)<\/nanori>/gu);
  const radical = values(block, /<rad_value rad_type="classical">([^<]+)<\/rad_value>/gu)[0] ?? null;
  return [literal, {
    meanings: unique([meanings]),
    onReadings: unique([onReadings]),
    kunReadings: unique([kunReadings]),
    nanoriReadings: unique([nanoriReadings]),
    radical,
  }];
};

export const parseKanjiLexicon = (xml) => Object.fromEntries(
  [...String(xml ?? "").matchAll(/<character>([\s\S]*?)<\/character>/gu)]
    .map(characterRecord)
    .filter(([literal]) => literal),
);
