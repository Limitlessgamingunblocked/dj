import { h, icon, money } from '../dom';
import { estimatePrint, price, PRICING_DEFAULTS, type PricingInputs } from '../estimate';
import { currentGoal } from '../state';

export interface ModelStats {
  volumeMm3: number;
  areaMm2: number;
  heightMm: number;
  overhangMm2: number;
}

const PRICING_KEY = 'replica.pricing';

function loadPricing(): PricingInputs {
  try {
    return { ...PRICING_DEFAULTS, ...JSON.parse(localStorage.getItem(PRICING_KEY) ?? '{}') };
  } catch {
    return { ...PRICING_DEFAULTS };
  }
}

/**
 * Print estimate plus, depending on the welcome answer, a selling calculator or print tips.
 * Call `update` whenever the model's size changes, and `refresh` when the goal changes.
 */
export function insightsPanel() {
  const el = h('div.insights');
  let stats: ModelStats | null = null;
  const pricing = loadPricing();

  const render = () => {
    el.replaceChildren();
    if (!stats) return;
    const est = estimatePrint(stats.volumeMm3, stats.areaMm2, stats.heightMm, stats.overhangMm2);
    const hours = est.hours < 1 ? `${Math.max(1, Math.round(est.hours * 60))} min` : `${est.hours.toFixed(1)} h`;
    el.append(
      h(
        'section.card',
        {},
        h('h3', {}, 'Print estimate'),
        h(
          'div.stats',
          {},
          h('div', {}, h('b', {}, `${est.grams.toFixed(est.grams < 10 ? 1 : 0)} g`), h('span', {}, 'PLA filament')),
          h('div', {}, h('b', {}, hours), h('span', {}, 'print time')),
          h('div', {}, h('b', {}, est.needsSupports ? 'Yes' : 'No'), h('span', {}, 'supports needed')),
        ),
        h('p.fine', {}, 'Rough guide for 0.2 mm layers, 15 % infill, 3 walls. Your slicer will give exact numbers.'),
      ),
    );

    if (currentGoal() === 'sell') {
      const out = h('div.price-out');
      const field = (key: keyof PricingInputs, label: string, suffix: string, step = '0.01') => {
        const input = h('input', { type: 'number', min: 0, step, value: String(pricing[key]), inputmode: 'decimal' });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          if (Number.isFinite(v) && v >= 0) {
            pricing[key] = v;
            try {
              localStorage.setItem(PRICING_KEY, JSON.stringify(pricing));
            } catch {
              /* ignore */
            }
            calc();
          }
        });
        return h('label.mini-field', {}, h('span', {}, label), h('span.with-suffix', {}, input, h('i', {}, suffix)));
      };
      const calc = () => {
        const p = price(est, pricing);
        out.replaceChildren(
          h('div.price-main', {}, h('span', {}, 'Suggested price'), h('b', {}, money(p.pricePerUnit))),
          h(
            'dl.breakdown',
            {},
            h('dt', {}, 'Filament'), h('dd', {}, money(p.material)),
            h('dt', {}, 'Printer time'), h('dd', {}, money(p.machine)),
            h('dt', {}, 'Your time'), h('dd', {}, money(p.labor)),
            h('dt', {}, 'Packaging'), h('dd', {}, money(pricing.packaging)),
            h('dt.total', {}, 'Cost per unit'), h('dd.total', {}, money(p.costPerUnit)),
            h('dt', {}, 'Profit per unit'), h('dd.good', {}, money(p.profitPerUnit)),
          ),
          h(
            'p.batch',
            {},
            `A run of ${Math.max(1, Math.round(pricing.quantity))}: `,
            h('b', {}, `${p.batchHours.toFixed(1)} printer-hours`),
            ', ',
            h('b', {}, `${p.batchFilamentKg.toFixed(2)} kg`),
            ' of filament, ',
            h('b', {}, `${money(p.batchProfit)} profit`),
            '.',
          ),
        );
      };
      el.append(
        h(
          'section.card.sell',
          {},
          h('h3', {}, icon('tag', 18), 'Selling calculator'),
          h(
            'div.mini-grid',
            {},
            field('filamentPerKg', 'Filament', '$/kg'),
            field('machinePerHour', 'Printer cost', '$/h'),
            field('laborMinutes', 'Your time', 'min', '1'),
            field('laborPerHour', 'Your rate', '$/h'),
            field('packaging', 'Packaging', '$'),
            field('markupPercent', 'Markup', '%', '1'),
            field('feePercent', 'Marketplace fee', '%', '0.1'),
            field('quantity', 'Batch size', 'pcs', '1'),
          ),
          out,
          h(
            'p.notice',
            {},
            icon('info', 16),
            h('span', {}, 'Only sell copies of things you designed or have the rights to. Copying branded, trademarked or patented products to sell can infringe on someone else’s rights.'),
          ),
        ),
      );
      calc();
    } else {
      el.append(
        h(
          'section.card',
          {},
          h('h3', {}, icon('spark', 18), 'Print tips'),
          h(
            'ul.tips',
            {},
            h('li', {}, 'The model already has a flat base — print it standing up, base on the bed.'),
            est.needsSupports
              ? h('li', {}, 'Some parts hang out over thin air. Turn on supports (“touching build plate” is usually enough).')
              : h('li', {}, 'No big overhangs, so you can skip supports.'),
            h('li', {}, 'Tall and thin? Add a brim so it doesn’t wobble loose.'),
            h('li', {}, 'Want it hollow and light? Lower the infill to 5–10 %.'),
          ),
        ),
      );
    }
  };

  return {
    el,
    update(next: ModelStats) {
      stats = next;
      render();
    },
    refresh: render,
  };
}
