"""Fetch small seeded samples of four public labeled datasets and normalize
them to one JSONL schema (data/sample_<discipline>.jsonl):

  {id, discipline, dataset, passage, question, options: {label: description}, gold}

Sources (all via Hugging Face; total < 6 MB):
  medicine : qiaojin/PubMedQA pqa_labeled            (MIT)
  law      : nguha/legalbench hearsay test            (CC-BY-4.0)
  science  : allenai/scifact claims validation + corpus (CC BY-NC 2.0)
  finance  : zeroshot/twitter-financial-news-sentiment validation (MIT)

Run with a Python that has pyarrow (SciFact ships as parquet).
"""
import json, random, sys, urllib.request
import pyarrow.parquet as pq

SEED = 42
N = 100
API = "https://datasets-server.huggingface.co/rows"


def fetch_all(dataset, config, split):
    rows, offset = [], 0
    while True:
        url = f"{API}?dataset={dataset}&config={config}&split={split}&offset={offset}&length=100"
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.load(r)
        rows += [x["row"] for x in d["rows"]]
        offset += 100
        if offset >= d["num_rows_total"]:
            return rows


def sample(items, n, seed):
    rnd = random.Random(seed)
    items = list(items)
    rnd.shuffle(items)
    return items[:n]


def write(name, items):
    path = f"data/sample_{name}.jsonl"
    with open(path, "w") as f:
        for it in items:
            f.write(json.dumps(it) + "\n")
    from collections import Counter
    print(name, len(items), dict(Counter(i["gold"] for i in items)))


# ---- medicine
def medicine():
    rows = fetch_all("qiaojin/PubMedQA", "pqa_labeled", "train")
    opts = {
        "yes": "The study's results support a positive answer to the question.",
        "no": "The study's results support a negative answer to the question.",
        "maybe": "The results are mixed or inconclusive for the question.",
    }
    items = []
    for r in rows:
        ctx = r["context"]["contexts"]
        labels = r["context"]["labels"]
        passage = "\n".join(f"{l}: {c}" for l, c in zip(labels, ctx))
        items.append({"id": f"med-{r['pubid']}", "discipline": "medicine", "dataset": "PubMedQA",
                      "passage": passage, "question": r["question"], "options": opts,
                      "gold": r["final_decision"]})
    write("medicine", sample(items, N, SEED))


# ---- law
def law():
    rows = fetch_all("nguha/legalbench", "hearsay", "test")
    opts = {
        "Yes": "The statement is hearsay: an out-of-court statement offered to prove the truth of the matter asserted.",
        "No": "The statement is not hearsay (e.g. not a statement, or not offered for its truth).",
    }
    items = [{"id": f"law-{r['index']}", "discipline": "law", "dataset": "LegalBench-hearsay",
              "passage": r["text"], "question": "Is the evidence described hearsay under the US Federal Rules of Evidence?",
              "options": opts, "gold": r["answer"]} for r in rows]
    write("law", sample(items, N, SEED))


# ---- science
def science():
    claims = pq.read_table("data/raw/scifact_claims_val.parquet").to_pylist()
    corpus = {r["doc_id"]: r for r in pq.read_table("data/raw/scifact_corpus.parquet").to_pylist()}
    opts = {
        "SUPPORT": "The abstract provides evidence that supports the claim.",
        "CONTRADICT": "The abstract provides evidence that contradicts the claim.",
    }
    seen, items = set(), []
    for c in claims:
        if c["evidence_label"] not in ("SUPPORT", "CONTRADICT") or c["id"] in seen:
            continue
        doc = corpus.get(int(c["evidence_doc_id"]))
        if not doc:
            continue
        seen.add(c["id"])
        passage = doc["title"] + "\n" + " ".join(doc["abstract"])
        items.append({"id": f"sci-{c['id']}", "discipline": "science", "dataset": "SciFact",
                      "passage": passage, "question": f"Claim: {c['claim']}\nDoes the abstract support or contradict this claim?",
                      "options": opts, "gold": c["evidence_label"]})
    write("science", sample(items, N, SEED))


# ---- finance
def finance():
    rows = fetch_all("zeroshot/twitter-financial-news-sentiment", "default", "validation")
    names = {0: "bearish", 1: "bullish", 2: "neutral"}
    opts = {
        "bearish": "The message implies negative expectations for the mentioned company or asset price.",
        "bullish": "The message implies positive expectations for the mentioned company or asset price.",
        "neutral": "The message carries no clear positive or negative price implication.",
    }
    items = [{"id": f"fin-{i}", "discipline": "finance", "dataset": "TwitterFinancialNews",
              "passage": r["text"], "question": "What price sentiment does this financial news message express?",
              "options": opts, "gold": names[r["label"]]} for i, r in enumerate(rows)]
    write("finance", sample(items, N, SEED))


if __name__ == "__main__":
    for fn in (medicine, law, science, finance):
        fn()
