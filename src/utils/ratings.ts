import { Recipe, RecipeRating } from '../types/recipe';

export interface RecipeRatingEntry extends RecipeRating {
  uid: string;
}

export interface RecipeRatingStats {
  average: number;
  count: number;
  entries: RecipeRatingEntry[];
}

export function getRecipeRatingStats(recipe: Recipe): RecipeRatingStats {
  const raw = recipe.ratings;
  if (!raw || typeof raw !== 'object') {
    return { average: 0, count: 0, entries: [] };
  }

  const entries: RecipeRatingEntry[] = [];
  let sum = 0;

  for (const [uid, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const score = Number(val.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) continue;
    const clamped = Math.round(score);
    sum += clamped;
    entries.push({
      uid,
      score: clamped,
      userName: typeof val.userName === 'string' && val.userName.trim() ? val.userName.trim() : 'Anonyme',
      updatedAt: typeof val.updatedAt === 'string' ? val.updatedAt : '',
    });
  }

  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = entries.length;
  const average = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

  return { average, count, entries };
}

export function formatAverageScore(average: number): string {
  return Number.isInteger(average) ? `${average}` : average.toFixed(1).replace('.', ',');
}

export function getUserDisplayLabel(
  user: { displayName?: string | null; email?: string | null } | null | undefined
): string {
  if (!user) return 'Moi';
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim();
  }
  if (user.email && user.email.includes('@')) {
    const prefix = user.email.split('@')[0].trim();
    if (prefix) return prefix;
  }
  return 'Anonyme';
}
