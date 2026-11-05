"""Offline-Import und vollständigen Forum-Katalog gegen die Weltkarte prüfen."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from expowiska import ROOT, BEGIN, END, build, components, icon_key, parse_html


class ExpowiskaTests(unittest.TestCase):
    def test_parser_preserves_average_recommendation_and_icons(self):
        text = '''<b><u>Mrówki (~20 lvl) – Kopiec Mrówek w Łanach Zboża</u></b><br>
        <img src="//example.test/obrazki/npc/zwi/mrowka03a.gif"><br>
        Pumy (~21 lvl) – Leśna Przełęcz<br><img src="//example.test/obrazki/npc/zwi/puma.gif"><br>
        <b>INNE EXPOWISKA</b><br>Premium (~270 lvl) – Instancja<br>
        <img src="//example.test/obrazki/npc/premium.gif"><br>Ostatnia aktualizacja: 23.06.2026'''
        source = parse_html(text)
        self.assertEqual(source['updated'], '2026-06-23')
        self.assertEqual(len(source['entries']), 2)
        self.assertTrue(source['entries'][0]['recommended'])
        self.assertFalse(source['entries'][1]['recommended'])
        self.assertEqual(source['entries'][0]['level'], 20)
        self.assertEqual(source['entries'][0]['icons'], ['zwi/mrowka03a.gif'])
        self.assertEqual(icon_key('hum/ghul6-a.gif'), icon_key('hum/ghul6-b.gif'))

    def test_directed_doors_do_not_create_false_roundtrips(self):
        world = {'1': [1, 1, 'A', [[2, 0, 0]], []], '2': [1, 1, 'B', [], []]}
        parts = components({1, 2}, world)
        self.assertEqual([p['maps'] for p in parts], [[1], [2]])

    def test_catalog_rebuild_and_embedded_copy(self):
        source = json.loads((ROOT / 'docs/expowiska-source.json').read_text())
        world = json.loads((ROOT / 'margobot_world.json').read_text())
        catalog = json.loads((ROOT / 'margobot_expowiska.json').read_text())
        self.assertEqual(build(source, world), catalog)
        self.assertEqual(len(catalog['entries']), 119)
        self.assertEqual(sum(e['recommended'] for e in catalog['entries']), 45)
        self.assertEqual(sum(len(e['parts']) for e in catalog['entries']), 131)
        text = (ROOT / 'margobot_auto.user.js').read_text()
        block = text.split(BEGIN, 1)[1].split(END, 1)[0]
        embedded = json.loads(block.split('const FORUM_EXPOWISKA = ', 1)[1].strip().removesuffix(';'))
        self.assertEqual(embedded, [{k: e[k] for k in ('id', 'name', 'level', 'recommended', 'lv', 'maps')}
                                    for e in catalog['entries']])
        for e in catalog['entries']:
            self.assertTrue(e['maps'], e['name'])
            self.assertLessEqual(e['lv'][0], e['level'])
            self.assertGreaterEqual(e['lv'][1], e['level'])
            self.assertLessEqual(e['lv'][1] - e['lv'][0], 15, e['name'])
            members = []
            for part in e['parts']:
                maps = part['maps']
                self.assertEqual(len(set(maps)), part['cards'])
                members.extend(set(maps))
                for a, b in zip(maps, maps[1:] + maps[:1]):
                    if len(maps) > 1:
                        self.assertNotEqual(a, b)
                        self.assertIn(b, [g[0] for g in world[str(a)][3]])
            self.assertEqual(sorted(members), e['maps'])
            self.assertEqual(len(members), len(set(members)))


if __name__ == '__main__': unittest.main()
