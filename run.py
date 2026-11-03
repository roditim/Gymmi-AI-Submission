import argparse
import json
from gymmi.config import live_config_status,require_live_config

if __name__=='__main__':
    p=argparse.ArgumentParser(description='Gymmi Analyst-to-Scientist contract-enforced Flow')
    p.add_argument('--csv',default='data/fitness_clean_deid.csv')
    p.add_argument('--output',default='runs/demo')
    p.add_argument('--download',action='store_true')
    p.add_argument('--handoff',help='Use an existing four-artifact Analyst handoff; do not re-clean raw data.')
    p.add_argument('--break',dest='break_case',choices=['units','column','contract','feature_values','feature_rows','feature_leakage'])
    p.add_argument('--live',action='store_true')
    p.add_argument('--check-live',action='store_true',help='Check local .env configuration without calling a provider or running the Flow.')
    args=p.parse_args()
    try:
        if args.check_live:
            status=live_config_status()
            print(json.dumps(status,indent=2))
            raise SystemExit(0 if status['configured'] else 2)
        if args.live:
            require_live_config()
        from gymmi.data import download
        from gymmi.flow import run
        if args.download:
            if args.handoff:raise ValueError('--download and --handoff are mutually exclusive')
            download(args.csv)
        flow=run(args.output,raw_path=None if args.handoff else args.csv,handoff_dir=args.handoff,
                 live=args.live,break_case=args.break_case)
        print(f'Flow completed. Eight required artifacts: {flow.output}')
    except Exception as exc:
        print(f'FLOW STOPPED: {exc}')
        raise SystemExit(2)
