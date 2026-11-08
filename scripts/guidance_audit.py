"""Summarize actual exported instructions, including a reproducible sample."""
import collections
import json
import re

WORDS={'prima':1,'seconda':2,'terza':3,'quarta':4,'quinta':5,'sesta':6,'settima':7,'ottava':8,'nona':9,'decima':10,'undicesima':11,'dodicesima':12,'tredicesima':13,'quattordicesima':14,'quindicesima':15,'sedicesima':16,'diciassettesima':17,'diciottesima':18,'diciannovesima':19,'ventesima':20}

def summarize(items):
    counts=collections.Counter(); samples=[]; total=0; unnumbered=0; routes=0; verified=0; recovery=collections.Counter(); recovery_samples=[]
    for data in items:
        routes+=1
        for turn in data.get('turns',[]):
            total+=1
            if turn.get('kind')!='roundabout':continue
            text=turn['text']; match=re.search(r'(\d+)ª uscita',text)
            count=int(match[1]) if match else next((n for word,n in WORDS.items() if f'la {word} uscita' in text),None)
            if count is None: unnumbered+=1
            else: counts[str(count)]+=1
            if len(samples)<100:samples.append({'id':data['academyId'],'at':turn['at'],'exit':count,'text':text})
        for item in data.get('roundaboutRecovery',[]):
            recovery['recovered' if item['recovered'] else item.get('reason') or 'unresolved']+=1
            if len(recovery_samples)<100:recovery_samples.append({'id':data['academyId'],**item})
        verified+=sum(r.get('numberVerified') is True for r in data.get('roundaboutAudit',[]))
    return {'routes':routes,'maneuvers':total,'roundaboutExitHistogram':dict(sorted(counts.items())),
            'roundaboutsWithoutVerifiedNumber':unnumbered,'verifiedNumberChecks':verified,'recovery':dict(recovery),'recoverySamples':recovery_samples,'samples':samples}
