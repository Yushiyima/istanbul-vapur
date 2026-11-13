import { describe, expect, it } from 'vitest';
import { FEED } from '../config/balance.ts';
import { locative, pushFeed } from './feed.ts';
import { createGame } from './state.ts';
import { testWorld } from './testWorld.ts';

describe('Peron', () => {
  it('bulunma eki ünlü uyumuna ve sert ünsüze uyar', () => {
    expect(locative('Kadıköy')).toBe('Kadıköy’de');
    expect(locative('Eminönü')).toBe('Eminönü’de');
    expect(locative('Balat')).toBe('Balat’ta');
    expect(locative('Bebek')).toBe('Bebek’te');
    expect(locative('Üsküdar')).toBe('Üsküdar’da');
    expect(locative('Sarıyer')).toBe('Sarıyer’de');
    expect(locative('Rumeli Kavağı')).toBe('Rumeli Kavağı’da');
  });

  it('şablon değişkenleri doldurulur, akış sınırlı kalır', () => {
    const state = createGame(2);
    const world = testWorld();
    for (let i = 0; i < FEED.maxPosts + 10; i++) pushFeed(state, world, 'crowded', { pier: 'Kadıköy' });
    expect(state.feed).toHaveLength(FEED.maxPosts);
    expect(state.feed.every((p) => !p.text.includes('{'))).toBe(true);
    expect(state.feed.some((p) => p.text.includes('Kadıköy'))).toBe(true);
  });
});
