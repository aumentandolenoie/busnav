"""Checks for Academy GPX immutable road enrichment. No external Valhalla needed."""
import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path

script = Path(__file__).resolve().parents[1] / "scripts" / "enrich_road_guidance.py"
spec = importlib.util.spec_from_file_location("academy_road_enrichment", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def encode_polyline6(points):
    result = []
    last_lat = last_lon = 0
    for lat, lon in points:
        a = round(lat * 1000000)
        b = round(lon * 1000000)
        for value in (a-last_lat, b-last_lon):
            code = ~(value << 1) if value < 0 else value << 1
            while code >= 32:
                result.append(chr((32 | (code & 31)) + 63))
                code >>= 5
            result.append(chr(code + 63))
        last_lat, last_lon = a, b
    return "".join(result)


class AcademyRoadTests(unittest.TestCase):
    def setUp(self):
        self.route = {
            "id": "academy_demo",
            "points": [[45.0, 11.0], [45.0, 11.005], [45.005, 11.005]]
        }
        self.points = self.route["points"]
        self.response = {
            "trip": {"language": "it-IT", "legs": [{
                "shape": encode_polyline6(self.points),
                "maneuvers": [
                    {"type": 1, "begin_shape_index": 0, "instruction": "Parti"},
                    {"type": 10, "begin_shape_index": 1, "instruction": "Svolta a destra in Via Roma"},
                    {"type": 4, "begin_shape_index": 2, "instruction": "Sei arrivato"}
                ]
            }]}
        }

    def test_italian_and_immutable_gpx(self):
        original = [p[:] for p in self.points]
        output = module.convert(self.route, self.response)
        self.assertEqual(self.points, original)
        self.assertEqual(output["language"], "it-IT")
        self.assertEqual(output["academyId"], "academy_demo")
        self.assertEqual(output["turns"][0]["text"], "Svolta a destra in Via Roma")
        self.assertEqual(output["turns"][0]["side"], "destra")
        self.assertTrue(output["validation"]["passed"])
        self.assertLess(output["validation"]["maxDeviationM"], 1)

    def test_correct_valhalla_maneuver_mapping(self):
        self.assertEqual(module.MANEUVER_TYPES[10], "right")
        self.assertEqual(module.MANEUVER_TYPES[15], "left")
        self.assertNotIn(12, module.MANEUVER_TYPES)
        self.assertNotIn(13, module.MANEUVER_TYPES)
        self.assertNotIn(27, module.MANEUVER_TYPES)

    def test_rejects_english_instructions(self):
        self.response["trip"]["language"] = "en-US"
        with self.assertRaisesRegex(ValueError, "Italian"):
            module.convert(self.route, self.response)

    def test_rejects_road_shortcut_even_if_endpoints_match(self):
        self.response["trip"]["legs"][0]["shape"] = encode_polyline6(
            [self.points[0], self.points[-1]]
        )
        with self.assertRaises(ValueError):
            module.convert(self.route, self.response)

    def test_rejects_wrong_direction(self):
        self.response["trip"]["legs"][0]["shape"] = encode_polyline6(
            list(reversed(self.points))
        )
        with self.assertRaises(ValueError):
            module.convert(self.route, self.response)

    def test_no_instructions_are_never_approved(self):
        self.response["trip"]["legs"][0]["maneuvers"] = []
        with self.assertRaisesRegex(ValueError, "no road maneuvers"):
            module.convert(self.route, self.response)

    def test_roundabout_exit_comes_from_road_network(self):
        maneuver = self.response["trip"]["legs"][0]["maneuvers"][1]
        maneuver.update(type=26, roundabout_exit_count=3)
        output = module.convert(self.route, self.response)
        self.assertEqual(output["turns"][0]["text"], "Alla rotonda, prendi la 3ª uscita")
        self.assertEqual(output["turns"][0]["kind"], "roundabout")
        del maneuver["roundabout_exit_count"]
        with self.assertRaises(ValueError):
            module.convert(self.route, self.response)

    def test_never_simplifies_gpx_to_meet_api_point_limit(self):
        with self.assertRaises(ValueError):
            module.downsample(self.points, limit=2)

    def test_two_close_turns_are_not_silently_dropped(self):
        # Correct directions can be closer together than the old 55m filter.
        self.route["points"] = [[45,11],[45,11.005],[45.0002,11.005],[45.005,11.005]]
        self.response["trip"]["legs"][0]["shape"] = encode_polyline6(self.route["points"])
        self.response["trip"]["legs"][0]["maneuvers"].insert(2,{
            "type":15,"begin_shape_index":2,"instruction":"Svolta a sinistra"})
        output=module.convert(self.route,self.response)
        self.assertEqual(len(output["turns"]),2)

    def test_partial_voice_coverage_keeps_failed_intervals_explicit(self):
        route={"id":"partial","points":[[45,11+i*.001] for i in range(81)]}
        original=[p[:] for p in route['points']]
        def response(endpoint,points,precise=False):
            if len(points)>35 or any(p[1]>11.02 for p in points):
                raise ValueError('No road match for this interval')
            return {'trip':{'language':'it-IT','legs':[{'shape':encode_polyline6(points),'maneuvers':[]}]}}
        with patch.object(module,'get_response',side_effect=response):
            data,attempts=module.annotate_route(route,'http://localhost:8002')
        self.assertIsNotNone(data)
        self.assertFalse(data['coverage']['complete'])
        self.assertGreater(data['coverage']['coveredM'],0)
        self.assertLess(data['coverage']['percent'],100)
        self.assertTrue(data['coverage']['gaps'])
        self.assertTrue(any(not a['accepted'] for a in attempts))
        self.assertEqual(route['points'],original)

    def test_no_matching_window_never_claims_voice_coverage(self):
        route={'id':'missing','points':[[45,11],[45,11.04]]}
        with patch.object(module,'get_response',side_effect=ValueError('unmatched')):
            data,attempts=module.annotate_route(route,'http://localhost:8002')
        self.assertIsNone(data)
        self.assertTrue(all(not a['accepted'] for a in attempts))

    def test_coverage_union_never_fills_a_real_gap(self):
        coverage=module.coverage_for([[0,200],[180,400],[450,500]],500)
        self.assertFalse(coverage['complete'])
        self.assertEqual(coverage['gaps'],[[400,450]])
        self.assertEqual(coverage['coveredM'],450)

    def test_trace_uses_bus_costing_and_italian(self):
        request = module.trace_request(self.points)
        self.assertEqual(request["costing"], "bus")
        self.assertEqual(request["shape_match"], "map_snap")
        self.assertEqual(request["directions_options"]["language"], "it-IT")


if __name__ == "__main__":
    unittest.main()

