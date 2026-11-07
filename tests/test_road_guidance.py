"""Checks for Academy GPX immutable road enrichment. No external Valhalla needed."""
import importlib.util
import unittest
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

    def test_trace_uses_bus_costing_and_italian(self):
        request = module.trace_request(self.points)
        self.assertEqual(request["costing"], "bus")
        self.assertEqual(request["shape_match"], "map_snap")
        self.assertEqual(request["directions_options"]["language"], "it-IT")


if __name__ == "__main__":
    unittest.main()
