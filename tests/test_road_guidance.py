"""Checks for Academy GPX immutable road enrichment. No external Valhalla needed."""
import importlib.util
import unittest
import sys
from unittest.mock import patch
from pathlib import Path

script = Path(__file__).resolve().parents[1] / "scripts" / "enrich_road_guidance.py"
sys.path.insert(0, str(script.parent))
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
                    {"type": 27, "begin_shape_index": 2, "end_shape_index":2,"instruction":"Esci dalla rotonda"},
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
        maneuver.update(type=26, end_shape_index=2, roundabout_exit_count=3)
        self.response["_drivingSideValidated"] = True
        output = module.convert(self.route, self.response)
        self.assertEqual(output["turns"][0]["text"], "Alla rotonda, prendi la terza uscita")
        self.assertEqual(output["turns"][0]["kind"], "roundabout")
        del maneuver["roundabout_exit_count"]
        output = module.convert(self.route, self.response)
        self.assertEqual(output['turns'][0]['text'],"Alla rotonda, segui il percorso GPX ufficiale")
        self.assertFalse(output['roundaboutAudit'][0]['numberVerified'])

    def test_real_6b_roundabouts_preserve_reference_first_second_and_third_exits(self):
        import json
        fixture=json.loads((Path(__file__).parent/'fixtures/roundabout-6b-reference.json').read_text())
        route=next(r for r in module.load_catalog() if str(r['id'])==fixture['academyId'])
        distances=module.cumulative(route['points'])
        for case in fixture['cases']:
            official=[p for p,d in zip(route['points'],distances) if case['startM']<=d<=case['endM']]
            self.assertEqual(case['points'],official,'Reference must use unmodified Academy GPX')
            data=module.convert({**route,'points':official},case['response'],allow_empty=True,strict_local=case['endM']-case['startM']<800)
            self.assertEqual([r['reportedExit'] for r in data['roundaboutAudit']],case['expectedExits'])
            self.assertTrue(all(r['numberVerified'] for r in data['roundaboutAudit']))
            words={1:'prima',2:'seconda',3:'terza'}
            self.assertEqual([t['text'] for t in data['turns'] if t['kind']=='roundabout'],
                [f"Alla rotonda, prendi la {words[n]} uscita" for n in case['expectedExits']])

    def test_roundabouts_have_distinct_first_second_third_fourth_exits(self):
        maneuver = self.response['trip']['legs'][0]['maneuvers'][1]
        maneuver.update(type=26,end_shape_index=2)
        self.response['_drivingSideValidated']=True
        for number,word in [(1,'prima'),(2,'seconda'),(3,'terza'),(4,'quarta')]:
            maneuver['roundabout_exit_count']=number
            output=module.convert(self.route,self.response)
            self.assertEqual(output['turns'][0]['text'],f'Alla rotonda, prendi la {word} uscita')
            self.assertTrue(output['roundaboutAudit'][0]['numberVerified'])

    def test_roundabout_number_requires_actual_right_hand_graph_validation(self):
        maneuver=self.response['trip']['legs'][0]['maneuvers'][1]
        maneuver.update(type=26,end_shape_index=2,roundabout_exit_count=2)
        for value in [False,None]:
            self.response['_drivingSideValidated']=value
            output=module.convert(self.route,self.response)
            self.assertNotIn('seconda',output['turns'][0]['text'])
            self.assertFalse(output['roundaboutAudit'][0]['numberVerified'])

    def test_roundabout_number_requires_complete_roundabout_shape(self):
        maneuver=self.response['trip']['legs'][0]['maneuvers'][1]
        maneuver.update(type=26,roundabout_exit_count=2)
        self.response['_drivingSideValidated']=True
        output=module.convert(self.route,self.response)
        self.assertNotIn('seconda',output['turns'][0]['text'])
        self.assertFalse(output['roundaboutAudit'][0]['numberVerified'])

    def test_roundabout_adjacent_wrong_exit_fails_local_geometry(self):
        official=[[45,11],[45,11.001],[45.0004,11.001],[45.0004,11.002]]
        wrong=[[45,11],[45,11.001],[45.0001,11.001],[45.0001,11.002]]
        d=module.cumulative(official); projected=module.ordered_projection(wrong,official,d)
        self.assertFalse(module.roundabout_geometry({'begin_shape_index':1,'end_shape_index':2},wrong,projected,official,d))

    def test_roundabout_boolean_count_is_never_a_number(self):
        maneuver=self.response['trip']['legs'][0]['maneuvers'][1]
        maneuver.update(type=26,end_shape_index=2,roundabout_exit_count=True)
        self.response['_drivingSideValidated']=True
        output=module.convert(self.route,self.response)
        self.assertFalse(output['roundaboutAudit'][0]['numberVerified'])

    def recovery_case(self,index):
        import json
        data=json.loads((Path(__file__).parent/'fixtures/roundabout-recovery-reference.json').read_text())['cases'][index]
        route={'id':data['row']['id'],'points':data['points']}
        target=data['row']['at']-data['startM']
        guidance={'turns':[{'at':target,'kind':'roundabout','side':'rotatoria','text':'Alla rotonda, segui il percorso GPX ufficiale'}]}
        return data,route,guidance

    def test_recovers_tiny_circle_with_equal_entry_exit_projection_and_verified_arms(self):
        import copy
        case,route,data=self.recovery_case(2);original=copy.deepcopy(route['points'])
        module._RECOVERY_CACHE.clear()
        def request(endpoint,points,precise=False):return case['response'] if precise else case['defaultResponse']
        with patch.object(module,'get_response',side_effect=request) as api:
            result=module.refine_roundabouts(route,data,'http://localhost:8002')
        self.assertEqual(api.call_count,2)
        self.assertEqual(result['turns'][0]['text'],'Alla rotonda, prendi la prima uscita')
        self.assertTrue(result['roundaboutRecovery'][0]['recovered'])
        self.assertEqual(route['points'],original)

    def test_real_tiny_roundabout_passes_tight_arm_validation(self):
        case,route,data=self.recovery_case(2);leg=case['response']['trip']['legs'][0]
        shape=module.decode_polyline(leg['shape']);d=module.cumulative(route['points'])
        projected=module.ordered_projection(shape,route['points'],d)
        m=next(m for m in leg['maneuvers'] if m['type']==26)
        ok,reason=module.roundabout_arm_geometry(m,shape,projected,route['points'],d)
        self.assertTrue(ok,reason)

    def test_conflicting_real_local_exit_counts_remain_unnumbered(self):
        case,route,data=self.recovery_case(1);module._RECOVERY_CACHE.clear()
        with patch.object(module,'get_response',side_effect=lambda endpoint,points,precise=False:case['response'] if precise else case['defaultResponse']):
            result=module.refine_roundabouts(route,data,'http://localhost:8002')
        self.assertIn('GPX ufficiale',result['turns'][0]['text'])
        self.assertEqual(result['roundaboutRecovery'][0]['reason'],'different-local-exit-counts')

    def test_truncated_circle_is_never_numbered(self):
        import copy
        case,route,data=self.recovery_case(2);response=copy.deepcopy(case['response'])
        leg=response['trip']['legs'][0];leg['maneuvers']=[m for m in leg['maneuvers'] if m['type']!=27]
        candidate,reason=module.local_roundabout_candidate(route,response,data['turns'][0]['at'])
        self.assertIsNone(candidate);self.assertEqual(reason,'incomplete-circle')

    def test_arm_recovery_rejects_real_discordant_gpx_geometry(self):
        case,route,data=self.recovery_case(3)
        candidate,reason=module.local_roundabout_candidate(route,case['response'],data['turns'][0]['at'])
        self.assertIsNone(candidate)

    def test_arm_recovery_requires_fifty_five_metres_of_context(self):
        import copy
        case,route,data=self.recovery_case(2);leg=case['response']['trip']['legs'][0]
        m=copy.deepcopy(next(m for m in leg['maneuvers'] if m['type']==26));shape=module.decode_polyline(leg['shape'])
        cut=max(0,m['begin_shape_index']-1);shape=shape[cut:m['end_shape_index']+2]
        m['begin_shape_index']-=cut;m['end_shape_index']-=cut
        d=module.cumulative(route['points']);projected=module.ordered_projection(shape,route['points'],d)
        ok,reason=module.roundabout_arm_geometry(m,shape,projected,route['points'],d)
        self.assertFalse(ok);self.assertEqual(reason,'insufficient-arm-context')

    def test_primary_numbering_requires_an_actual_exit_maneuver(self):
        m=self.response['trip']['legs'][0]['maneuvers'][1];m.update(type=26,end_shape_index=2,roundabout_exit_count=2)
        self.response['_drivingSideValidated']=True
        self.response['trip']['legs'][0]['maneuvers']=[m for m in self.response['trip']['legs'][0]['maneuvers'] if m['type']!=27]
        out=module.convert(self.route,self.response)
        self.assertFalse(out['roundaboutAudit'][0]['numberVerified'])

    def test_road_safety_uses_the_verified_way_and_camera_direction(self):
        import road_safety
        points = [[45.0,11.0],[45.001,11.0],[45.002,11.0],[45.003,11.0]]
        camera = {"id": 9, "kind": "redLight", "from": points[1], "to": points[2],
                  "device": points[2], "fromWays": [71], "toWays": [71]}
        catalog = road_safety.index_catalog({"limits": {"71": 50}, "cameras": [camera]})
        for track, way, expected_count in [(points, 71, 1), (points[::-1], 71, 0), (points, 72, 0)]:
            with self.subTest(way=way, count=expected_count):
                shape = encode_polyline6(track)
                response = {"trip": {"language":"it-IT","legs":[{"shape":shape,"maneuvers":[]} ]},
                            "_edgeAttributes": {"shape":shape,"edges":[{"way_id":way,"begin_shape_index":0,"end_shape_index":3}]}}
                data = module.convert({"id":"safety","points":track}, response, allow_empty=True, safety=catalog)
                self.assertEqual(len(data["roadCameras"]), expected_count)
                self.assertEqual([r[2] for r in data["speedLimits"]], [50] if way == 71 else [])

    def test_point_camera_tags_and_directions(self):
        from road_safety import point_camera_kind, oneway_sense, point_camera_senses
        self.assertEqual(point_camera_kind({"highway":"speed_camera"}), "speed")
        self.assertEqual(point_camera_kind({"highway":"red_light_camera"}), "redLight")
        self.assertEqual(point_camera_kind({"man_made":"surveillance","surveillance":"red_light"}), "redLight")
        self.assertIsNone(point_camera_kind({"highway":"speed_camera","mobile":"yes"}))
        self.assertIsNone(point_camera_kind({"man_made":"surveillance","surveillance":"traffic"}))
        self.assertEqual(oneway_sense({"oneway":"yes"}), 1)
        self.assertEqual(oneway_sense({"oneway":"-1"}), -1)
        self.assertEqual(oneway_sense({"junction":"roundabout"}), 1)
        self.assertEqual(oneway_sense({"highway":"primary"}), 0)
        self.assertEqual(point_camera_senses("forward", 0), [(1, True)])
        self.assertEqual(point_camera_senses("backward", 0), [(-1, True)])
        self.assertEqual(point_camera_senses("", 1), [(1, True)])
        self.assertEqual(point_camera_senses("both", 0), [(1, True), (-1, True)])
        # Degrees or no direction on a two-way road: both directions, flagged as not certain.
        self.assertEqual(point_camera_senses("90", 0), [(1, False), (-1, False)])
        self.assertEqual(point_camera_senses("", 0), [(1, False), (-1, False)])

    def test_point_camera_on_the_driven_way_is_announced_in_its_direction(self):
        import road_safety
        points = [[45.0,11.0],[45.001,11.0],[45.002,11.0],[45.003,11.0]]
        nodes = {1: points[0], 2: points[1], 4: points[3]}
        for direction, track, expected in [("forward", points, [(1, True)]), ("forward", points[::-1], []),
                                           ("backward", points[::-1], [(1, True)]), ("", points, [(1, False)]),
                                           ("", points[::-1], [(1, False)])]:
            with self.subTest(direction=direction, reverse=track is not points):
                tags = {3: ("speed", direction, points[2])}
                ways = {3: [(71, [2, 1], [4], 0, None)]}
                cameras = road_safety.point_cameras(tags, ways, nodes)
                catalog = road_safety.index_catalog({"limits": {"71": 50}, "cameras": cameras})
                shape = encode_polyline6(track)
                response = {"trip": {"language":"it-IT","legs":[{"shape":shape,"maneuvers":[]} ]},
                            "_edgeAttributes": {"shape":shape,"edges":[{"way_id":71,"begin_shape_index":0,"end_shape_index":3}]}}
                data = module.convert({"id":"camera","points":track}, response, allow_empty=True, safety=catalog)
                found = [(1, c.get("certain", True)) for c in data["roadCameras"]]
                self.assertEqual(found, expected)
                for c in data["roadCameras"]:
                    self.assertEqual(c["kind"], "speed")

    def test_camera_beside_the_road_is_snapped_onto_the_nearest_road(self):
        import road_safety
        road = [[45.0,11.0],[45.001,11.0],[45.002,11.0],[45.003,11.0]]
        beside = [45.0015, 11.00012]           # about 9 m east of the road
        far = [45.0015, 11.0004]               # about 31 m: too far
        snapper = road_safety.RoadSnapper({7: beside, 8: far})
        snapper.offer(71, road)
        self.assertIn(7, snapper.best); self.assertNotIn(8, snapper.best)
        d, way, index, point = snapper.best[7]
        self.assertEqual((way, index), (71, 1)); self.assertLess(abs(d - 9.4), 1)
        self.assertAlmostEqual(point[1], 11.0, places=6); self.assertAlmostEqual(point[0], 45.0015, places=6)
        # The snapped point is used as the camera position on the road.
        nodes = {1: road[0], 2: road[1], 3: road[2], 4: road[3]}
        cameras = road_safety.point_cameras({7: ("speed", "", beside)}, {7: [(71, [2, 1], [3, 4], 1, point)]}, nodes)
        self.assertEqual(len(cameras), 1)
        self.assertEqual(cameras[0]["to"], point); self.assertNotIn("certain", cameras[0])

    def test_speed_recovery_checks_attribute_geometry_in_travel_order(self):
        import road_safety
        points = [[45.0,11.0],[45.001,11.0],[45.002,11.0]]
        original = [p[:] for p in points]
        base = encode_polyline6(points)
        attributes = [[45.0,11.0],[45.0005,11.0],[45.001,11.0],[45.002,11.0]]
        catalog = road_safety.index_catalog({"limits":{"71":50}, "cameras":[]})
        for track, expected in [(attributes, [50]), (attributes[::-1], []),
                                ([[lat,lon+.00004] for lat,lon in attributes], [])]:
            with self.subTest(track=track):
                response = {"trip":{"language":"it-IT","legs":[{"shape":base,"maneuvers":[]}]},
                            "_edgeAttributes":{"shape":encode_polyline6(track),"edges":[
                                {"way_id":71,"begin_shape_index":0,"end_shape_index":3}]}}
                data = module.convert({"id":"safety","points":points}, response, allow_empty=True, safety=catalog)
                self.assertEqual([r[2] for r in data["speedLimits"]], expected)
                self.assertEqual(points, original)

    def test_speed_limit_does_not_follow_a_nearby_parallel_way(self):
        import road_safety
        points = [[45.0,11.0],[45.001,11.0],[45.002,11.0]]
        # Six metres is acceptable for the maneuver trace, but can put its
        # speed annotation on the wrong road.
        trace = [[lat, lon + .00008] for lat, lon in points]
        shape = encode_polyline6(trace)
        catalog = road_safety.index_catalog({"limits":{"71":90}, "cameras":[]})
        response = {"trip":{"language":"it-IT","legs":[{"shape":shape,"maneuvers":[]}]},
                    "_edgeAttributes":{"shape":shape,"edges":[
                        {"way_id":71,"begin_shape_index":0,"end_shape_index":2}]}}
        data = module.convert({"id":"parallel","points":points}, response, allow_empty=True, safety=catalog)
        self.assertEqual(data["speedLimits"], [])

    def test_bus_limits_keep_their_evidence_and_reject_restrictions(self):
        from road_safety import classify_speed, TIER_SIGN, TIER_MAPPED, TIER_LEGAL
        cases = [
            ({"maxspeed":"50 km/h","maxspeed:type":"sign"}, "residential", (50, TIER_SIGN)),
            ({"maxspeed":"30","source:maxspeed":"markings"}, "tertiary", (30, TIER_SIGN)),
            ({"maxspeed":"70"}, "secondary", (70, TIER_MAPPED)),
            ({"maxspeed":"60","source:maxspeed":"survey"}, "secondary", (60, TIER_MAPPED)),
            ({"maxspeed":"IT:urban"}, "residential", (50, TIER_LEGAL)),
            ({"maxspeed":"50","source:maxspeed":"IT:urban"}, "residential", (50, TIER_LEGAL)),
            # Art. 142 c.3 lett. f: a bus above 8 t never exceeds 80 km/h outside
            # motorways and 100 km/h on motorways, whatever the road sign says.
            ({"maxspeed":"90","source:maxspeed":"IT:rural"}, "secondary", (80, TIER_LEGAL)),
            ({"maxspeed":"90","source:maxspeed":"sign"}, "primary", (80, TIER_SIGN)),
            ({"maxspeed":"110","maxspeed:type":"IT:trunk"}, "trunk", (80, TIER_LEGAL)),
            ({"maxspeed":"IT:motorway"}, "motorway", (100, TIER_LEGAL)),
            ({"maxspeed":"130","source:maxspeed":"sign"}, "motorway", (100, TIER_SIGN)),
            # Limits for other vehicles do not apply to buses; bus limits do.
            ({"maxspeed":"90","maxspeed:hgv":"70"}, "secondary", (80, TIER_MAPPED)),
            ({"maxspeed":"50","source:maxspeed":"sign","maxspeed:bus":"30"}, "secondary", (30, TIER_SIGN)),
        ]
        for tags, highway, expected in cases:
            with self.subTest(tags=tags):
                self.assertEqual(classify_speed(tags, highway), expected)
        for tags in [{"maxspeed":"90","source:maxspeed":"sign","maxspeed:type":"IT:rural"},
                     {"maxspeed":"70","source:maxspeed":"IT:urban"}, {"maxspeed":"IT:urban","source:maxspeed":"sign"},
                     {"maxspeed":"50","source:maxspeed":"sign","maxspeed:forward":"30"},
                     {"maxspeed":"50","source:maxspeed":"sign","maxspeed:variable":"yes"},
                     {"maxspeed":"50","maxspeed:bus:conditional":"30 @ (Mo-Fr)"},
                     {"maxspeed":"50","source:maxspeed":"sign","maxspeed:conditional":"30 @ (Mo-Fr)"},
                     {"maxspeed":"none"}, {"maxspeed":"walk"}, {"maxspeed":"30 mph"}, {"maxspeed":"50;30"}, {}]:
            with self.subTest(tags=tags):
                self.assertIsNone(classify_speed(tags, "secondary"))

    def test_speed_limit_report_counts_each_metre_once_per_tier(self):
        import csv, json, subprocess, tempfile
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / "1.json").write_text(json.dumps({"academyId": "1", "officialLengthM": 1000, "speedLimitPolicy": 3,
                "speedLimits": [[0, 400, 50, 1], [300, 500, 50, 1], [600, 800, 80, 3], [800, 900, 50]]}))
            prefix = folder / "report"
            subprocess.run([sys.executable, str(script.parent / "speed_limit_report.py"), str(folder), str(prefix)],
                           check=True, capture_output=True)
            row = next(csv.DictReader(open(prefix.with_suffix(".csv"))))
            self.assertEqual((row["km_con_limite"], row["km_cartello"], row["km_legale"], row["percentuale"]),
                             ("0.8", "0.6", "0.2", "80.0"))

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

    def test_short_window_rejects_shortcut_hidden_by_global_tolerance(self):
        route={'id':'short','points':[[45,11],[45,11.0007],[45.0005,11.0007]]}
        response={'trip':{'language':'it-IT','legs':[{'shape':encode_polyline6([route['points'][0],route['points'][-1]]),'maneuvers':[]}]}}
        # The global 90m floor would accept this corner cut on a 110m trace.
        module.convert(route,response,allow_empty=True)
        with self.assertRaises(ValueError):module.convert(route,response,allow_empty=True,strict_local=True)

    def test_precise_short_window_keeps_a_real_turn_near_boundary(self):
        points=[[45,11],[45,11.0005],[45.0006,11.0005]]
        route={'id':'short-turn','points':points}
        response={'trip':{'language':'it-IT','legs':[{'shape':encode_polyline6(points),'maneuvers':[
            {'type':10,'begin_shape_index':1,'instruction':'Svolta a destra'}]}]}}
        self.assertFalse(module.convert(route,response,allow_empty=True)['turns'])
        output=module.convert(route,response,allow_empty=True,strict_local=True)
        self.assertEqual(len(output['turns']),1)
        self.assertTrue(output['validation']['passed'])

    def test_trace_uses_bus_costing_and_italian(self):
        request = module.trace_request(self.points)
        self.assertEqual(request["costing"], "bus")
        self.assertEqual(request["shape_match"], "map_snap")
        self.assertEqual(request["directions_options"]["language"], "it-IT")


if __name__ == "__main__":
    unittest.main()
