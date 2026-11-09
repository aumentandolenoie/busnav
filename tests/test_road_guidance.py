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
                self.assertEqual([limit for _,_,limit in data["speedLimits"]], expected)
                self.assertEqual(points, original)

    def test_numeric_limits_accept_units_and_descriptive_tags_but_not_restrictions(self):
        from road_safety import explicit_speed
        self.assertEqual(explicit_speed({"maxspeed":"50 km/h","maxspeed:type":"sign"}), 50)
        for tags in [{"maxspeed":"IT:urban"}, {"maxspeed":"50","maxspeed:forward":"30"},
                     {"maxspeed":"50","maxspeed:bus":"30"}, {"maxspeed":"50","maxspeed:variable":"yes"},
                     {"maxspeed":"50","maxspeed:conditional":"30 @ (Mo-Fr)"}]:
            self.assertIsNone(explicit_speed(tags))

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
