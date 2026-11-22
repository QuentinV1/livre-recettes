import { getAI, getGenerativeModel, GoogleAIBackend, type Part } from 'firebase/ai';
import { app } from '../lib/firebase';
import { cropImageByNormalizedBox } from './image';
import {
  Ingredient,
  NutritionRow,
  RecipeStep,
  SUGGESTED_TAGS,
} from '../types/recipe';

export interface ParsedRecipeDraft {
  recipeNumber?: string;
  title?: string;
  subtitle?: string;
  prepTimeMinutes?: number;
  prepTimeRange?: string;
  servings?: number;
  tags?: string[];
  utensils?: string[];
  ingredients: Ingredient[];
  steps: string[];
  stepDetails?: RecipeStep[];
  nutrition?: NutritionRow[];
  allergens?: string;
  notes?: string;
  rawText?: string;
  dishImage?: string;
}

function makeId(prefix = 'ing'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const KNOWN_UNITS = [
  'kg',
  'g',
  'mg',
  'ml',
  'cl',
  'dl',
  'l',
  'cm',
  'cs',
  'c.s.',
  'c. à s.',
  'cuillère à soupe',
  'cuillères à soupe',
  'cc',
  'c.c.',
  'c. à c.',
  'cuillère à café',
  'cuillères à café',
  'pièce',
  'pièces',
  'pièce(s)',
  'tranche',
  'tranches',
  'tranche(s)',
  'gousse',
  'gousses',
  'gousse(s)',
  'brin',
  'brins',
  'brin(s)',
  'botte',
  'bottes',
  'bouquet',
  'sachet',
  'sachets',
  'sachet(s)',
  'boîte',
  'boîtes',
  'boîte(s)',
  'pincée',
  'pincées',
  'poignée',
  'poignées',
  'pot',
  'pots',
  'pot(s)',
  'filet',
  'filets',
  'pavé',
  'pavés',
  'paquet',
  'paquets',
  'paquet(s)',
];

const HELLOFRESH_KNOWN_TAGS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\b[ée]pic[ée]e?s?\b/i, tag: 'épicé' },
  { pattern: /\bv[ée]g[ée]tarien(?:ne)?\b|\bveggie\b/i, tag: 'végétarien' },
  { pattern: /\brapide\b|\bexpress\b|\bpr[êe]t en 20\b/i, tag: 'rapide' },
  { pattern: /\bfamille\b/i, tag: 'famille' },
  { pattern: /\bclassique\b/i, tag: 'classique' },
  { pattern: /\bhealthy\b|\b[ée]quilibr[ée]\b|\bmoins de \d+ kcal\b|\bcalorie smart\b/i, tag: 'healthy' },
  { pattern: /\bconfort\b|\bgourmand\b/i, tag: 'confort' },
  { pattern: /\bworld\b|\basiatique\b|\bmexicain\b|\bitalien\b|\bindien\b/i, tag: 'world' },
  { pattern: /\bpoulet\b/i, tag: 'poulet' },
  { pattern: /\bpoisson\b|\bsaumon\b|\bcabillaud\b|\bcrevette/i, tag: 'poisson' },
  { pattern: /\bb[oœ]uf\b/i, tag: 'bœuf' },
  { pattern: /\bp[âa]tes?\b|\bpenne\b|\bspaghetti\b|\bnouilles?\b/i, tag: 'pâte' },
  { pattern: /\briz\b|\brisotto\b/i, tag: 'riz' },
];

export function formatStepSummary(step: RecipeStep): string {
  const body = step.bullets.join(' ').trim();
  const base = step.title ? `${step.title} — ${body}` : body;
  return step.chefTip ? `${base} (Astuce du chef : ${step.chefTip})` : base;
}

/**
 * Parse une ligne d'ingrédient, en gérant à la fois :
 * - Format HelloFresh (nom à gauche, quantité + unité à droite : "Oignon nouveau* 75 g", "Poivre et sel selon votre goût")
 * - Format standard (quantité + unité au début : "200 g de riz")
 */
function parseIngredientLine(line: string, fromPantry = false): Ingredient {
  const cleaned = line
    .replace(/^[-•*▪◦]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 1. Cas "selon votre goût" / "selon goût" / "au goût" en fin de ligne
  const tasteMatch = cleaned.match(/^(.+?)\s+(selon\s+(?:votre\s+)?go[ûu]t|au\s+go[ûu]t)$/i);
  if (tasteMatch) {
    return {
      id: makeId(),
      name: tasteMatch[1].replace(/\*+$/, '').trim(),
      quantity: '',
      unit: tasteMatch[2].trim(),
      fromPantry,
    };
  }

  // 2. Format HelloFresh : Nom suivi de quantité + unité en fin de ligne
  // Ex: "Gousse d'ail 1 pièce(s)", "Oignon nouveau* 75 g", "Huile de tournesol 4 cc", "Pâte Pho 25 g"
  const endQtyMatch = cleaned.match(
    /^(.+?)\s+(\d+(?:[.,/]\d+)?)\s*([a-zA-Zéèêëàâîïôùûç().]+(?:\s+[a-zA-Zéèêëàâîïôùûç().]+)?)?$/i
  );
  if (endQtyMatch) {
    const rawName = endQtyMatch[1].replace(/\*+$/, '').trim();
    const qty = endQtyMatch[2].replace(',', '.');
    const rawUnit = (endQtyMatch[3] ?? '').trim();
    if (rawName.length >= 2 && !/^\d+$/.test(rawName)) {
      return {
        id: makeId(),
        name: rawName,
        quantity: qty,
        unit: rawUnit || 'pièce(s)',
        fromPantry,
      };
    }
  }

  // 3. Format standard : Quantité + unité en début de ligne ("200 g de riz")
  const startQtyMatch = cleaned.match(
    /^(\d+(?:[.,/]\d+)?)\s*([a-zA-Zéèêëàâîïôùûç().]+)?\s*(?:de\s+|d'|d’)?(.+)$/i
  );
  if (startQtyMatch) {
    const qty = startQtyMatch[1].replace(',', '.');
    const maybeUnit = (startQtyMatch[2] ?? '').trim();
    const rest = startQtyMatch[3].replace(/\*+$/, '').trim();

    const unitLower = maybeUnit.toLowerCase();
    const isKnownUnit = KNOWN_UNITS.some((u) => u.toLowerCase() === unitLower);

    if (isKnownUnit) {
      return {
        id: makeId(),
        quantity: qty,
        unit: maybeUnit,
        name: rest,
        fromPantry,
      };
    }

    return {
      id: makeId(),
      quantity: qty,
      unit: 'pièce(s)',
      name: maybeUnit ? `${maybeUnit} ${rest}`.trim() : rest,
      fromPantry,
    };
  }

  return {
    id: makeId(),
    quantity: '',
    unit: '',
    name: cleaned.replace(/\*+$/, '').trim(),
    fromPantry,
  };
}

/**
 * Extrait temps de préparation (simple ou intervalle "35 - 45 Min") et tags depuis un texte.
 */
function extractTimeAndTags(text: string): {
  prepTimeMinutes?: number;
  prepTimeRange?: string;
  tags: string[];
} {
  let prepTimeMinutes: number | undefined;
  let prepTimeRange: string | undefined;

  const rangeMatch = text.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:min|minutes?)\b/i);
  if (rangeMatch) {
    const minT = parseInt(rangeMatch[1], 10);
    const maxT = parseInt(rangeMatch[2], 10);
    if (minT > 0 && maxT >= minT && maxT <= 240) {
      prepTimeRange = `${minT} - ${maxT} min`;
      prepTimeMinutes = Math.round((minT + maxT) / 2);
    }
  } else {
    const singleMatch = text.match(/(\d{1,3})\s*(?:min|minutes?)\b/i);
    if (singleMatch) {
      const parsedTime = parseInt(singleMatch[1], 10);
      if (parsedTime > 0 && parsedTime <= 240) {
        prepTimeMinutes = parsedTime;
      }
    }
  }

  const lowerFull = text.toLowerCase();
  const detectedTags = new Set<string>();
  if (prepTimeMinutes && prepTimeMinutes <= 25) detectedTags.add('rapide');

  for (const tag of SUGGESTED_TAGS) {
    if (lowerFull.includes(tag)) detectedTags.add(tag);
  }
  for (const rule of HELLOFRESH_KNOWN_TAGS) {
    if (rule.pattern.test(text)) detectedTags.add(rule.tag);
  }

  return {
    prepTimeMinutes,
    prepTimeRange,
    tags: Array.from(detectedTags),
  };
}

/**
 * Parseur pour l'en-tête du Recto HelloFresh (logo, numéro recette, titre, sous-titre, tags colorés, temps).
 */
function parseRectoHeaderText(text: string): Partial<ParsedRecipeDraft> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const result: Partial<ParsedRecipeDraft> = {};
  const { prepTimeMinutes, prepTimeRange, tags } = extractTimeAndTags(text);
  if (prepTimeMinutes) result.prepTimeMinutes = prepTimeMinutes;
  if (prepTimeRange) result.prepTimeRange = prepTimeRange;
  if (tags.length > 0) result.tags = tags;

  const numMatch = text.match(/recette\s*n?[°o]?\s*(\d+)/i);
  if (numMatch) {
    result.recipeNumber = `Recette ${numMatch[1]}`;
  }

  const titleCandidates: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    // Ignorer bruit logo / numéro / ligne temps+tags
    if (/^(hello\s*fresh|hello|fresh)$/i.test(lower)) continue;
    if (/^recette\s*\d+/i.test(lower)) continue;
    if (/[àa]\s*table\s*dans/i.test(lower) || /\d+\s*[-–]?\s*\d*\s*min\b/i.test(lower)) continue;
    // Ignorer lignes trop courtes qui sont souvent des tags seuls ("Épicé", "Végétarien")
    if (line.length < 12 && !/\s/.test(line)) continue;
    titleCandidates.push(line);
  }

  if (titleCandidates.length >= 1) {
    result.title = titleCandidates[0];
  }
  if (titleCandidates.length >= 2) {
    result.subtitle = titleCandidates[1];
  }

  return result;
}

const NUTRITION_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /[ée]nergie/i, label: 'Énergie (kJ/kcal)' },
  { pattern: /lipides?\s*total/i, label: 'Lipides total (g)' },
  { pattern: /dont\s*satur[ée]s?/i, label: 'Dont saturés (g)' },
  { pattern: /glucides?/i, label: 'Glucides (g)' },
  { pattern: /dont\s*sucres?/i, label: 'Dont sucres (g)' },
  { pattern: /fibres?/i, label: 'Fibres (g)' },
  { pattern: /prot[ée]ines?/i, label: 'Protéines (g)' },
  { pattern: /\bsel\b/i, label: 'Sel (g)' },
];

function parseNutritionLine(line: string): NutritionRow | null {
  for (const item of NUTRITION_LABELS) {
    if (item.pattern.test(line)) {
      // Cherche les valeurs numériques (ex: "3021 / 722  616 / 147" ou "31  6" ou "4,7  1,0")
      const afterLabel = line.replace(item.pattern, '').replace(/\(.*?\)/g, '').trim();
      const tokens = afterLabel.match(/\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?/g);
      if (tokens && tokens.length >= 2) {
        return {
          label: item.label,
          perServing: tokens[0].replace(/\s+/g, ' '),
          per100g: tokens[1].replace(/\s+/g, ' '),
        };
      }
      if (tokens && tokens.length === 1) {
        return {
          label: item.label,
          perServing: tokens[0].replace(/\s+/g, ' '),
          per100g: '',
        };
      }
    }
  }
  return null;
}

/**
 * Parseur pour la colonne de gauche du Verso HelloFresh :
 * Ustensiles -> Ingrédients (box) -> À ajouter vous-même -> Valeurs nutritionnelles -> Allergènes
 */
function parseVersoLeftColumn(text: string): Partial<ParsedRecipeDraft> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: Partial<ParsedRecipeDraft> = {
    utensils: [],
    ingredients: [],
    nutrition: [],
  };

  let section: 'intro' | 'utensils' | 'box' | 'pantry' | 'nutrition' | 'allergens' | 'done' =
    'intro';
  const utensilsBuffer: string[] = [];
  const allergenLines: string[] = [];

  const servingsMatch = text.match(/(\d{1,2})\s*(?:personnes?|pers\.?|portions?)\b/i);
  if (servingsMatch) {
    const s = parseInt(servingsMatch[1], 10);
    if (s >= 1 && s <= 12) result.servings = s;
  }

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/mes\s*ustensiles|ustensiles/i.test(lower)) {
      section = 'utensils';
      const inline = line.replace(/^.*?ustensiles\s*:?\s*/i, '').trim();
      if (inline) utensilsBuffer.push(inline);
      continue;
    }

    if (/ingr[ée]dients?\s*(pour|dans)/i.test(lower) || /^ingr[ée]dients?$/i.test(lower)) {
      section = 'box';
      continue;
    }

    if (/ajouter\s*vous[- ]m[êe]me|dans\s*votre\s*cuisine/i.test(lower)) {
      section = 'pantry';
      continue;
    }

    if (/^\*?\s*[àa]\s*conserver\s*au\s*r[ée]frig[ée]rateur/i.test(lower)) {
      continue;
    }

    if (/valeurs?\s*nutritionnelles?/i.test(lower)) {
      section = 'nutrition';
      continue;
    }

    if (/^allerg[èe]nes?\b/i.test(lower)) {
      section = 'allergens';
      const inline = line.replace(/^allerg[èe]nes?\s*:?\s*/i, '').trim();
      if (inline) allergenLines.push(inline);
      continue;
    }

    if (/partagez\s*vos\s*photos|hellofresh|semaine\s*#?\d+/i.test(lower)) {
      if (section === 'allergens') section = 'done';
      continue;
    }

    if (section === 'utensils') {
      utensilsBuffer.push(line);
      continue;
    }

    if (section === 'box' || section === 'pantry') {
      if (/^par\s*portion|^pour\s*100\s*g/i.test(lower)) {
        section = 'nutrition';
        continue;
      }
      if (line.length >= 2) {
        result.ingredients!.push(parseIngredientLine(line, section === 'pantry'));
      }
      continue;
    }

    if (section === 'nutrition') {
      if (/^par\s*portion|^pour\s*100\s*g/i.test(lower)) continue;
      const row = parseNutritionLine(line);
      if (row) result.nutrition!.push(row);
      continue;
    }

    if (section === 'allergens') {
      allergenLines.push(line);
    }
  }

  if (utensilsBuffer.length > 0) {
    result.utensils = utensilsBuffer
      .join(' ')
      .split(/[,;]+/)
      .map((u) => u.replace(/\.$/, '').trim())
      .filter((u) => u.length >= 2);
  }

  if (allergenLines.length > 0) {
    result.allergens = allergenLines.join(' ').trim();
  }

  return result;
}

/**
 * Parseur pour une cellule d'étape (1..6) du Verso HelloFresh :
 * Titre + sous-étapes (bullet points) + éventuelle "Astuce du chef".
 */
function parseStepCellText(text: string): RecipeStep | null {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) return null;

  let title: string | undefined;
  const bullets: string[] = [];
  const tipLines: string[] = [];
  let inTip = false;

  for (const line of rawLines) {
    const lower = line.toLowerCase();

    // Ignorer numéro d'étape isolé ("1", "2", ...) ou signature finale
    if (/^[1-6]$/.test(line)) continue;
    if (/^[àa]\s*vos\s*baguettes|bon\s*app[ée]tit/i.test(lower)) continue;

    // Détection "L'ASTUCE DU CHEF :"
    if (/l['’]?\s*astuce\s*du\s*chef/i.test(lower)) {
      inTip = true;
      const cleanedTip = line.replace(/^.*?astuce\s*du\s*chef\s*:?\s*/i, '').trim();
      if (cleanedTip) tipLines.push(cleanedTip);
      continue;
    }

    if (inTip) {
      tipLines.push(line);
      continue;
    }

    const isBullet = /^[•●▪◦\-*]\s+/.test(line);
    const cleanedLine = line.replace(/^[•●▪◦\-*]\s+/, '').trim();

    if (!title && !isBullet && bullets.length === 0 && cleanedLine.length >= 3 && cleanedLine.length <= 60) {
      title = cleanedLine.replace(/^[1-6][.)\s]+/, '').trim();
      continue;
    }

    if (isBullet || bullets.length === 0) {
      bullets.push(cleanedLine);
    } else {
      // Ligne de continuation d'un bullet point multi-lignes
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${cleanedLine}`.trim();
    }
  }

  if (!title && bullets.length === 0) return null;

  return {
    title,
    bullets,
    chefTip: tipLines.length > 0 ? tipLines.join(' ').trim() : undefined,
  };
}

/**
 * Parseur intelligent pour texte collé ou issu d'OCR (fiches HelloFresh ou recettes web).
 */
export function parseRecipeText(rawText: string): ParsedRecipeDraft {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const draft: ParsedRecipeDraft = {
    ingredients: [],
    steps: [],
    rawText,
  };

  if (lines.length === 0) return draft;

  const { prepTimeMinutes, prepTimeRange, tags } = extractTimeAndTags(rawText);
  if (prepTimeMinutes) draft.prepTimeMinutes = prepTimeMinutes;
  if (prepTimeRange) draft.prepTimeRange = prepTimeRange;
  if (tags.length > 0) draft.tags = tags;

  const numMatch = rawText.match(/recette\s*n?[°o]?\s*(\d+)/i);
  if (numMatch) draft.recipeNumber = `Recette ${numMatch[1]}`;

  const servingsMatch = rawText.match(/(\d{1,2})\s*(?:personnes?|pers\.?|portions?)\b/i);
  if (servingsMatch) {
    const parsedServings = parseInt(servingsMatch[1], 10);
    if (parsedServings >= 1 && parsedServings <= 12) {
      draft.servings = parsedServings;
    }
  }

  let section: 'header' | 'utensils' | 'ingredients' | 'pantry' | 'nutrition' | 'allergens' | 'steps' =
    'header';
  const stepBuffer: string[] = [];
  const utensilsBuffer: string[] = [];
  const nutritionBuffer: NutritionRow[] = [];
  const allergenBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (/^(mes\s*)?ustensiles/i.test(lower)) {
      section = 'utensils';
      const inline = line.replace(/^.*?ustensiles\s*:?\s*/i, '').trim();
      if (inline) utensilsBuffer.push(inline);
      continue;
    }

    if (/^(ingr[ée]dients?|dans votre box|ce dont vous avez besoin)/i.test(lower)) {
      section = 'ingredients';
      continue;
    }

    if (/ajouter\s*vous[- ]m[êe]me/i.test(lower)) {
      section = 'pantry';
      continue;
    }

    if (/^valeurs?\s*nutritionnelles?/i.test(lower)) {
      section = 'nutrition';
      continue;
    }

    if (/^allerg[èe]nes?\b/i.test(lower)) {
      section = 'allergens';
      const inline = line.replace(/^allerg[èe]nes?\s*:?\s*/i, '').trim();
      if (inline) allergenBuffer.push(inline);
      continue;
    }

    if (/^([ée]tapes?|pr[ée]paration|instructions?|recette)/i.test(lower) && !/^recette\s*\d+/i.test(lower)) {
      section = 'steps';
      continue;
    }

    const numberedStep = line.match(/^(?:[ée]tape\s*)?(\d{1,2})[.)\-:]\s+(.+)$/i);
    if (numberedStep && numberedStep[2].length > 10) {
      section = 'steps';
      stepBuffer.push(numberedStep[2].trim());
      continue;
    }

    if (section === 'header') {
      if (/^(hello\s*fresh|recette\s*\d+)/i.test(lower)) continue;
      if (!draft.title && line.length >= 4 && !/^\d+\s*(min|pers)/i.test(line)) {
        draft.title = line;
      } else if (draft.title && !draft.subtitle && line.length >= 6 && !/^\d+\s*(min|pers)/i.test(line)) {
        if (/^\d/.test(line)) {
          section = 'ingredients';
          draft.ingredients.push(parseIngredientLine(line, false));
        } else {
          draft.subtitle = line;
        }
      }
      continue;
    }

    if (section === 'utensils') {
      utensilsBuffer.push(line);
      continue;
    }

    if (section === 'ingredients' || section === 'pantry') {
      if (line.length > 85 && /\b(faites|coupez|préchauffez|mélangez|ajoutez|servez|versez)\b/i.test(lower)) {
        section = 'steps';
        stepBuffer.push(line);
      } else {
        draft.ingredients.push(parseIngredientLine(line, section === 'pantry'));
      }
      continue;
    }

    if (section === 'nutrition') {
      const row = parseNutritionLine(line);
      if (row) nutritionBuffer.push(row);
      continue;
    }

    if (section === 'allergens') {
      allergenBuffer.push(line);
      continue;
    }

    if (section === 'steps') {
      const cleanedStep = line.replace(/^[-•*]\s*/, '').trim();
      if (cleanedStep.length > 5) {
        stepBuffer.push(cleanedStep);
      }
    }
  }

  if (utensilsBuffer.length > 0) {
    draft.utensils = utensilsBuffer
      .join(' ')
      .split(/[,;]+/)
      .map((u) => u.replace(/\.$/, '').trim())
      .filter((u) => u.length >= 2);
  }
  if (nutritionBuffer.length > 0) draft.nutrition = nutritionBuffer;
  if (allergenBuffer.length > 0) draft.allergens = allergenBuffer.join(' ').trim();
  draft.steps = stepBuffer;
  return draft;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Découpe une zone relative (0..1) d'une image, l'agrandit si besoin et améliore le contraste pour Tesseract.
 */
async function cropAndEnhanceZone(
  imageDataUrl: string,
  rect: CropRect,
  minWidth = 1000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Impossible de charger l’image pour le découpage OCR.'));
    img.onload = () => {
      const sx = Math.max(0, Math.floor(img.width * rect.x));
      const sy = Math.max(0, Math.floor(img.height * rect.y));
      const sw = Math.max(10, Math.min(img.width - sx, Math.floor(img.width * rect.w)));
      const sh = Math.max(10, Math.min(img.height - sy, Math.floor(img.height * rect.h)));

      const scale = sw < minWidth ? minWidth / sw : 1;
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);

      const canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

      // Niveaux de gris + léger boost de contraste pour texte imprimé sur papier
      const imgData = ctx.getImageData(0, 0, dw, dh);
      const d = imgData.data;
      const contrast = 1.35;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const enhanced = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
        d[i] = enhanced;
        d[i + 1] = enhanced;
        d[i + 2] = enhanced;
      }
      ctx.putImageData(imgData, 0, 0);

      resolve(canvas.toDataURL('image/png'));
    };
    img.src = imageDataUrl;
  });
}

/**
 * Extraction OCR multi-zones côté client avec Tesseract.js, calibrée sur le format des fiches HelloFresh :
 * - Recto : en-tête (titre, sous-titre, tags colorés, temps X - Y min)
 * - Verso gauche : ustensiles, ingrédients (box + à ajouter vous-même), valeurs nutritionnelles, allergènes
 * - Verso droite : grille 3×2 des 6 étapes (titre, sous-étapes en bullet points, astuce du chef)
 */
export async function extractRecipeWithTesseract(
  rectoDataUrl?: string,
  versoDataUrl?: string,
  onProgress?: (progressPct: number, statusLabel: string) => void
): Promise<ParsedRecipeDraft> {
  const Tesseract = await import('tesseract.js');
  onProgress?.(5, 'Chargement du moteur OCR français…');
  const worker = await Tesseract.createWorker('fra');

  const draft: ParsedRecipeDraft = {
    ingredients: [],
    steps: [],
    stepDetails: [],
  };
  const rawSections: string[] = [];

  try {
    const tasks: Array<{
      label: string;
      img: string;
      rect: CropRect;
      minWidth: number;
      handler: (text: string) => void;
    }> = [];

    if (rectoDataUrl) {
      tasks.push({
        label: 'Lecture de l’en-tête recto (titre, tags, temps)…',
        img: rectoDataUrl,
        rect: { x: 0.12, y: 0.0, w: 0.88, h: 0.28 },
        minWidth: 1100,
        handler: (text) => {
          rawSections.push(`=== RECTO EN-TÊTE ===\n${text}`);
          const header = parseRectoHeaderText(text);
          if (header.recipeNumber) draft.recipeNumber = header.recipeNumber;
          if (header.title) draft.title = header.title;
          if (header.subtitle) draft.subtitle = header.subtitle;
          if (header.prepTimeMinutes) draft.prepTimeMinutes = header.prepTimeMinutes;
          if (header.prepTimeRange) draft.prepTimeRange = header.prepTimeRange;
          if (header.tags?.length) draft.tags = header.tags;
        },
      });
    }

    if (versoDataUrl) {
      tasks.push({
        label: 'Lecture colonne gauche (ustensiles, ingrédients, nutrition, allergènes)…',
        img: versoDataUrl,
        rect: { x: 0.0, y: 0.0, w: 0.35, h: 1.0 },
        minWidth: 1000,
        handler: (text) => {
          rawSections.push(`=== VERSO COLONNE GAUCHE ===\n${text}`);
          const left = parseVersoLeftColumn(text);
          if (left.servings) draft.servings = left.servings;
          if (left.utensils?.length) draft.utensils = left.utensils;
          if (left.ingredients?.length) draft.ingredients = left.ingredients;
          if (left.nutrition?.length) draft.nutrition = left.nutrition;
          if (left.allergens) draft.allergens = left.allergens;
        },
      });

      // Grille 3 colonnes × 2 lignes pour les 6 étapes
      const colBounds = [
        { x: 0.31, w: 0.24 },
        { x: 0.54, w: 0.24 },
        { x: 0.77, w: 0.23 },
      ];
      const rowBounds = [
        { y: 0.02, h: 0.49 },
        { y: 0.49, h: 0.51 },
      ];

      let stepIdx = 1;
      for (const row of rowBounds) {
        for (const col of colBounds) {
          const currentStepNum = stepIdx++;
          // On saute le haut de la photo (~22% de la cellule) pour lire directement titre + bullets + astuce
          const textRect: CropRect = {
            x: col.x,
            y: row.y + row.h * 0.22,
            w: col.w,
            h: row.h * 0.78,
          };
          tasks.push({
            label: `Lecture de l’étape ${currentStepNum}/6…`,
            img: versoDataUrl,
            rect: textRect,
            minWidth: 850,
            handler: (text) => {
              rawSections.push(`=== ÉTAPE ${currentStepNum} ===\n${text}`);
              const parsedStep = parseStepCellText(text);
              if (parsedStep) {
                draft.stepDetails!.push(parsedStep);
                draft.steps.push(formatStepSummary(parsedStep));
              }
            },
          });
        }
      }
    }

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const pct = Math.round(10 + ((i + 1) / tasks.length) * 88);
      onProgress?.(pct, t.label);
      const zoneImg = await cropAndEnhanceZone(t.img, t.rect, t.minWidth);
      const res = await worker.recognize(zoneImg);
      t.handler(res.data.text);
    }

    // Détection de tags complémentaires sur l'ensemble du texte extrait
    const fullCombined = rawSections.join('\n');
    const extraTags = extractTimeAndTags(fullCombined).tags;
    if (extraTags.length > 0) {
      draft.tags = Array.from(new Set([...(draft.tags ?? []), ...extraTags]));
    }
    draft.rawText = fullCombined;
  } finally {
    await worker.terminate();
  }

  return draft;
}

/**
 * Extraction structurée via Google Gemini Vision API (si clé fournie par l'utilisateur).
 */
export async function extractRecipeWithGeminiVision(
  apiKey: string,
  rectoDataUrl?: string,
  versoDataUrl?: string
): Promise<ParsedRecipeDraft> {
  const parts: Array<Record<string, unknown>> = [
    {
      text: `Analyse ces photos d'une fiche recette HelloFresh (recto et/ou verso) et extrais un JSON strict sans markdown.
Structure connue de la fiche :
- RECTO : en haut le numéro ("Recette XXX"), le titre, le sous-titre, les tags colorés (ex: Épicé, Végétarien), et le temps de préparation (ex: "À table dans : 35 - 45 Min"). En grand au centre/gauche, la photo du plat cuisiné. À droite la liste visuelle des ingrédients de la box.
- VERSO colonne gauche : "Mes ustensiles", "Ingrédients pour X personnes" (dans la box), "À ajouter vous-même" (fromPantry: true), "Valeurs nutritionnelles" (Par portion / Pour 100 g), et "Allergènes".
- VERSO partie droite : grille des étapes (généralement 6). Chaque étape a un titre, des sous-étapes (bullet points) et parfois "L'ASTUCE DU CHEF".

Retourne exactement ce JSON valide en français :
{
  "recipeNumber": "Recette 244",
  "title": "Titre du plat",
  "subtitle": "Sous-titre ou accompagnement",
  "prepTimeRange": "35 - 45 min",
  "prepTimeMinutes": 40,
  "servings": 2,
  "tags": ["épicé", "végétarien"],
  "dishBox": [220, 40, 950, 680],
  "utensils": ["Bol", "Sauteuse"],
  "ingredients": [
    { "name": "Nom ingrédient", "quantity": "150", "unit": "g", "fromPantry": false },
    { "name": "Huile de tournesol", "quantity": "4", "unit": "cc", "fromPantry": true }
  ],
  "stepDetails": [
    {
      "title": "Chop, chop, chop",
      "bullets": ["Sous-étape 1...", "Sous-étape 2..."],
      "chefTip": "Astuce du chef si présente, sinon null"
    }
  ],
  "nutrition": [
    { "label": "Énergie (kJ/kcal)", "perServing": "3021 / 722", "per100g": "616 / 147" }
  ],
  "allergens": "Texte des allergènes"
}
Pour "dishBox" : indique les coordonnées normalisées [ymin, xmin, ymax, xmax] (entiers de 0 à 1000) encadrant uniquement la grande photo du plat cuisiné sur la première image (recto), sans inclure le titre ni la colonne des ingrédients. Mets null si aucune photo de plat n'est visible.`,
    },
  ];

  for (const dataUrl of [rectoDataUrl, versoDataUrl]) {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) continue;
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64,
      },
    });
  }

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let rawJson = '';

  if (app) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const aiParts: (string | Part)[] = [
      String(parts[0].text ?? ''),
      ...parts.slice(1).map((p) => {
        const inline = p.inline_data as { mime_type: string; data: string };
        return { type: 'inlineData', inlineData: { mimeType: inline.mime_type, data: inline.data } } as Part;
      }),
    ];

    let lastAiError: unknown;
    for (const modelName of models) {
      const model = getGenerativeModel(ai, {
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.15,
        },
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await model.generateContent(aiParts);
          rawJson = res.response.text() || '{}';
          break;
        } catch (err) {
          lastAiError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient = /\b(500|503|429)\b|internal|unavailable|overloaded|network/i.test(msg);
          if (isTransient && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          break;
        }
      }
      if (rawJson) break;
    }
    if (!rawJson) {
      throw new Error(
        lastAiError instanceof Error
          ? `Erreur Firebase AI Logic : ${lastAiError.message}`
          : 'Erreur Firebase AI Logic.'
      );
    }
  } else {
    if (!apiKey) {
      throw new Error('Firebase AI Logic non initialisé et aucune clé API fournie.');
    }
    const requestBody = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.15,
      },
    });

    let response: Response | undefined;
    let lastErrorStatus = 0;
    let lastErrorText = '';

    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          }
        );

        if (response.ok) break;

        lastErrorStatus = response.status;
        lastErrorText = await response.text();

        const isTransient = response.status === 503 || response.status === 429 || response.status === 500;
        if (isTransient && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        if (isTransient || response.status === 404) {
          break;
        }
        throw new Error(`Erreur API Gemini (${lastErrorStatus}) : ${lastErrorText.slice(0, 180)}`);
      }

      if (response?.ok) break;
    }

    if (!response || !response.ok) {
      if (lastErrorStatus === 503 || lastErrorStatus === 429) {
        throw new Error(
          `Les serveurs Gemini sont temporairement surchargés (${lastErrorStatus}). Réessayez dans quelques instants ou utilisez l'OCR local.`
        );
      }
      throw new Error(`Erreur API Gemini (${lastErrorStatus}) : ${lastErrorText.slice(0, 180)}`);
    }

    const data = await response.json();
    rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  }

  const parsed = JSON.parse(rawJson);

  const stepDetails: RecipeStep[] = Array.isArray(parsed.stepDetails)
    ? parsed.stepDetails.map((s: { title?: string; bullets?: unknown[]; chefTip?: string | null }) => ({
        title: s.title ? String(s.title).trim() : undefined,
        bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).trim()).filter(Boolean) : [],
        chefTip: s.chefTip ? String(s.chefTip).trim() : undefined,
      }))
    : [];

  const flatSteps: string[] =
    stepDetails.length > 0
      ? stepDetails.map(formatStepSummary)
      : Array.isArray(parsed.steps)
        ? parsed.steps.map((s: unknown) => String(s))
        : [];

  let dishImage: string | undefined;
  if (
    rectoDataUrl &&
    Array.isArray(parsed.dishBox) &&
    parsed.dishBox.length === 4 &&
    parsed.dishBox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
  ) {
    try {
      dishImage = await cropImageByNormalizedBox(
        rectoDataUrl,
        parsed.dishBox as [number, number, number, number]
      );
    } catch {
      // Si le recadrage échoue, on conserve tout de même l'extraction texte de la recette
    }
  }

  return {
    recipeNumber: parsed.recipeNumber ? String(parsed.recipeNumber) : undefined,
    title: parsed.title || undefined,
    subtitle: parsed.subtitle || undefined,
    prepTimeRange: parsed.prepTimeRange ? String(parsed.prepTimeRange) : undefined,
    prepTimeMinutes: typeof parsed.prepTimeMinutes === 'number' ? parsed.prepTimeMinutes : undefined,
    servings: typeof parsed.servings === 'number' ? parsed.servings : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: unknown) => String(t).toLowerCase()) : [],
    utensils: Array.isArray(parsed.utensils)
      ? parsed.utensils.map((u: unknown) => String(u).trim()).filter(Boolean)
      : undefined,
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map(
          (ing: { name?: string; quantity?: string; unit?: string; fromPantry?: boolean }) => ({
            id: makeId(),
            name: String(ing.name ?? ''),
            quantity: String(ing.quantity ?? ''),
            unit: String(ing.unit ?? ''),
            fromPantry: Boolean(ing.fromPantry),
          })
        )
      : [],
    steps: flatSteps,
    stepDetails: stepDetails.length > 0 ? stepDetails : undefined,
    nutrition: Array.isArray(parsed.nutrition)
      ? parsed.nutrition.map((n: { label?: string; perServing?: string; per100g?: string }) => ({
          label: String(n.label ?? ''),
          perServing: String(n.perServing ?? ''),
          per100g: String(n.per100g ?? ''),
        }))
      : undefined,
    allergens: parsed.allergens ? String(parsed.allergens) : undefined,
    dishImage,
  };
}
