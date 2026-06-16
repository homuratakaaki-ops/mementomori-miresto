'use strict';

const PARTS_PER_EXCHANGE = 10;
const CRYSTALS_PER_EXCHANGE = 3;

const VALID_WEAPON_LEVELS = [
  0,
  180, 200, 220, 240,
  250, 260, 270, 280, 290, 300,
  310, 320, 330, 340, 350, 360, 370, 380, 390, 400,
  410, 420, 430, 440, 450, 460, 470, 480, 490, 500,
  510, 520
];

const WEAPON_COST_TABLE = [
  { from: 0, to: 180, parts: 80 },
  { from: 180, to: 200, parts: 50 },
  { from: 200, to: 220, parts: 65 },
  { from: 220, to: 240, parts: 80 },
  { from: 240, to: 250, parts: 15 },
  { from: 250, to: 260, parts: 15 },
  { from: 260, to: 270, parts: 15 },
  { from: 270, to: 280, parts: 20 },
  { from: 280, to: 290, parts: 20 },
  { from: 290, to: 300, parts: 20 },
  { from: 300, to: 310, parts: 30 },
  { from: 310, to: 320, parts: 30 },
  { from: 320, to: 330, parts: 30 },
  ...Array.from({ length: (520 - 330) / 10 }, (_, index) => ({
    from: 330 + index * 10,
    to: 340 + index * 10,
    parts: 40
  }))
];

function requiresAwakeningWarning(targetLevel) {
  return targetLevel > 240;
}
