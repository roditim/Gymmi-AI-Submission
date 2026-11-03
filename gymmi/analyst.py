'The Analyst alone receives the licensed raw study file.'
import base64
from pathlib import Path
import pandas as pd
from .data import load_clean, profile, URL, DOI, VERSION, SHA256, LICENSE, LICENSE_URL, AUTHORS, PRIMARY, TARGET
from .contracts import DatasetContract, Column, FeatureSpec, SplitSpec, LIMITATIONS
from .boundary import sha256
from .util import write_json


class AnalystWorkspace:
    def __init__(self, raw_path, output, run_id):
        self.raw_path, self.output, self.run_id = Path(raw_path), Path(output), run_id

    def ingest(self):
        raw, clean = load_clean(self.raw_path)
        clean.to_csv(self.output / 'clean_data.csv', index=False)
        write_json(self.output / 'data_profile.json', profile(raw, clean))
        write_json(self.output / 'provenance.json', {'source_url': URL, 'doi': DOI, 'version': VERSION,
            'source_sha256': SHA256, 'license': LICENSE, 'license_url': LICENSE_URL, 'authors': AUTHORS,
            'changes': 'Keep four history counts; add row key; derive week2>0; drop all other source fields.',
            'source_record': 'https://zenodo.org/records/18866086'})
        return ['clean_data.csv']

    def explore(self):
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        data = pd.read_csv(self.output / 'clean_data.csv')
        fig, axes = plt.subplots(2, 2, figsize=(11, 8), layout='constrained')
        data[TARGET].value_counts().sort_index().plot.bar(ax=axes[0, 0], color='#168b85', rot=0)
        axes[0, 0].set(title='Week-two outcome', xlabel='Any visit (zero / one)', ylabel='Study records')
        data.week1.plot.hist(ax=axes[0, 1], bins=8, color='#168b85')
        axes[0, 1].set(title='Week-one visits', xlabel='Visits', ylabel='Study records')
        data[PRIMARY].plot.box(ax=axes[1, 0])
        axes[1, 0].set(title='History inputs', ylabel='Visits per recorded week')
        data.groupby('week1')[TARGET].mean().plot(ax=axes[1, 1], marker='o', color='#168b85')
        axes[1, 1].set(title='History and next-week outcome', xlabel='Week-one visits', ylabel='Observed outcome fraction')
        chart = self.output / 'eda_charts.png'
        fig.savefig(chart, dpi=120)
        plt.close(fig)
        image = base64.b64encode(chart.read_bytes()).decode()
        text = f'''# Gymmi weekly-visit insights

The licensed study file has {len(data)} records. The outcome is whether week2 has any visits: {int(data[TARGET].sum())} positive records ({data[TARGET].mean():.2%}). Records are not a verified count of unique people.

Only prewk1, prewk2, prewk3 and week1 become model inputs. week2 defines the target. Later weeks, totals, rewards, demographics and academic data are excluded.

The selected columns have no missing values. Repeated input histories can have different outcomes. Equal histories are grouped during splitting; this conservative stress test can create unequal split sizes and prevalence.

The source description refers to 245 participants, while the file has 389 rows. Without person identifiers we cannot resolve the discrepancy or prove person-independent evaluation. Relative week ordering is assumed from column names; exact dates are absent.

These are descriptive associations from an experiment, not evidence of causal incentives, calibrated probabilities or reliable deployment in a new gym. CC BY 4.0 attribution and changes are in DATA_ATTRIBUTION.md.
'''
        (self.output / 'insights.md').write_text(text, encoding='utf-8')
        report = f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Gymmi EDA</title><style>body{{font:17px/1.6 sans-serif;max-width:1050px;margin:30px auto;padding:18px}}img{{width:100%}}td,th{{padding:7px;border:1px solid #ddd}}</style><h1>Gymmi weekly visits</h1><p>{len(data)} research records; observed week-two attendance {data[TARGET].mean():.2%}. Descriptive associations only.</p><p>Condliffe, Isgin and Saboe, Gym Use Behavioral Economics Experiment, Zenodo v1, DOI {DOI}, CC BY 4.0. Changes: select history fields, add row key and derive binary target.</p><p>The source says 245 participants; the file has 389 rows. No person-independent or chronological evaluation is claimed.</p><img alt="Outcome counts, history distributions and observed association" src="data:image/png;base64,{image}">{data[PRIMARY].describe().to_html()}<p>This is not booked-class no-show prediction. No causal, calibration or new-population claim.</p></html>'''
        (self.output / 'eda_report.html').write_text(report, encoding='utf-8')
        return ['eda_report.html', 'insights.md']

    def publish(self):
        data = pd.read_csv(self.output / 'clean_data.csv', dtype={'record_id': str})
        columns = [Column(name='record_id', dtype='string', unit='row_key', unique=True)]
        columns += [Column(name=name, dtype='integer', unit='visits_per_recorded_week', minimum=0, maximum=100) for name in PRIMARY]
        columns += [Column(name=TARGET, dtype='integer', unit='binary_week2_any_visit', allowed_values=[0, 1])]
        contract = DatasetContract(run_id=self.run_id, dataset_sha256=sha256(self.output / 'clean_data.csv'),
            rows=len(data), columns=columns, features=FeatureSpec(numeric=PRIMARY, categorical=[],
                excluded={'record_id': 'Generated row key, not a participant ID.', TARGET: 'Outcome only; never a model input.'}),
            split=SplitSpec(target=TARGET, id_column='record_id', group_columns=PRIMARY),
            source={'url': URL, 'doi': DOI, 'version': VERSION, 'raw_sha256': SHA256, 'license': LICENSE,
                'license_url': LICENSE_URL, 'authors': AUTHORS}, assumptions=LIMITATIONS,
            constraints=['The Scientist receives only clean_data.csv and the contract.',
                'Fit preprocessing on train; select models and thresholds on validation only.',
                'Never use week2, later visits, totals, rewards, demographics or academic fields as inputs.',
                'Redistribute with attribution and a description of modifications.'])
        write_json(self.output / 'dataset_contract.json', contract.model_dump())
        return ['dataset_contract.json']
