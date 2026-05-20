"""
core/retriever.py — Recuperación híbrida BM25 + FAISS (dense).
Implementa: Naive RAG, Advanced RAG (reranking), Modular RAG.
"""
import json
import os
import pickle
from pathlib import Path
from typing import Optional

import faiss
import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

FAISS_INDEX_PATH = Path(os.getenv("FAISS_INDEX_DIR", "/app/faiss_index"))
KNOWLEDGE_DIR = Path(os.getenv("KNOWLEDGE_DIR", "/app/knowledge"))
EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

ALPHA = 0.6  # peso dense vs BM25: ALPHA*dense + (1-ALPHA)*bm25


class HybridRetriever:
    """
    Modular RAG: retriever intercambiable.
    Soporta Naive RAG (solo dense) y Advanced RAG (BM25 + dense + reranking).
    """

    def __init__(self):
        self._embedder: Optional[SentenceTransformer] = None
        self._index: Optional[faiss.IndexFlatIP] = None
        self._chunks: list[dict] = []
        self._bm25: Optional[BM25Okapi] = None
        self._loaded = False

    def _embedder_lazy(self) -> SentenceTransformer:
        if self._embedder is None:
            self._embedder = SentenceTransformer(EMBED_MODEL)
        return self._embedder

    def build_index(self) -> None:
        """Carga documentos de /app/knowledge y construye FAISS + BM25."""
        docs = self._load_knowledge()
        if not docs:
            print("⚠ Sin documentos en knowledge/ — índice vacío")
            self._loaded = True
            return

        embedder = self._embedder_lazy()
        texts = [d["text"] for d in docs]
        embeddings = embedder.encode(texts, normalize_embeddings=True, show_progress_bar=True)

        dim = embeddings.shape[1]
        self._index = faiss.IndexFlatIP(dim)
        self._index.add(embeddings.astype(np.float32))
        self._chunks = docs

        tokenized = [t.lower().split() for t in texts]
        self._bm25 = BM25Okapi(tokenized)

        FAISS_INDEX_PATH.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self._index, str(FAISS_INDEX_PATH / "index.faiss"))
        with open(FAISS_INDEX_PATH / "chunks.pkl", "wb") as f:
            pickle.dump(self._chunks, f)
        self._loaded = True
        print(f"✅ Índice construido: {len(docs)} documentos")

    def load_index(self) -> bool:
        idx_path = FAISS_INDEX_PATH / "index.faiss"
        chunks_path = FAISS_INDEX_PATH / "chunks.pkl"
        if idx_path.exists() and chunks_path.exists():
            self._index = faiss.read_index(str(idx_path))
            with open(chunks_path, "rb") as f:
                self._chunks = pickle.load(f)
            tokenized = [c["text"].lower().split() for c in self._chunks]
            self._bm25 = BM25Okapi(tokenized) if tokenized else None
            self._loaded = True
            print(f"✅ Índice cargado: {len(self._chunks)} chunks")
            return True
        return False

    def retrieve(self, query: str, k: int = 5, mode: str = "hybrid") -> list[dict]:
        """
        mode: 'naive' (solo FAISS), 'hybrid' (BM25+FAISS), 'rerank' (con reranking).
        Implementa Naive RAG y Advanced RAG según el modo.
        """
        if not self._loaded or not self._chunks:
            return []

        if mode == "naive":
            return self._dense_search(query, k)

        dense_results = self._dense_search(query, k * 2)
        bm25_results = self._bm25_search(query, k * 2) if self._bm25 else []
        combined = self._fuse(dense_results, bm25_results, k)

        if mode == "rerank":
            combined = self._rerank(query, combined)[:k]

        return combined

    def _dense_search(self, query: str, k: int) -> list[dict]:
        if self._index is None:
            return []
        embedder = self._embedder_lazy()
        q_emb = embedder.encode([query], normalize_embeddings=True).astype(np.float32)
        scores, ids = self._index.search(q_emb, min(k, len(self._chunks)))
        results = []
        for score, idx in zip(scores[0], ids[0]):
            if idx >= 0:
                results.append({**self._chunks[idx], "score": float(score), "source": "dense"})
        return results

    def _bm25_search(self, query: str, k: int) -> list[dict]:
        tokens = query.lower().split()
        scores = self._bm25.get_scores(tokens)
        top_ids = np.argsort(scores)[::-1][:k]
        max_score = scores[top_ids[0]] if len(top_ids) > 0 else 1
        results = []
        for idx in top_ids:
            if scores[idx] > 0:
                norm = float(scores[idx]) / (max_score + 1e-9)
                results.append({**self._chunks[idx], "score": norm, "source": "bm25"})
        return results

    def _fuse(self, dense: list[dict], bm25: list[dict], k: int) -> list[dict]:
        scores: dict[str, float] = {}
        chunks_map: dict[str, dict] = {}
        for r in dense:
            key = r["text"][:100]
            scores[key] = scores.get(key, 0) + ALPHA * r["score"]
            chunks_map[key] = r
        for r in bm25:
            key = r["text"][:100]
            scores[key] = scores.get(key, 0) + (1 - ALPHA) * r["score"]
            chunks_map[key] = r
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:k]
        return [chunks_map[k] for k, _ in ranked]

    def _rerank(self, query: str, candidates: list[dict]) -> list[dict]:
        if not candidates:
            return []
        embedder = self._embedder_lazy()
        q_emb = embedder.encode([query], normalize_embeddings=True)[0]
        for c in candidates:
            c_emb = embedder.encode([c["text"]], normalize_embeddings=True)[0]
            c["rerank_score"] = float(np.dot(q_emb, c_emb))
        return sorted(candidates, key=lambda x: x.get("rerank_score", 0), reverse=True)

    def _load_knowledge(self) -> list[dict]:
        chunks = []
        if not KNOWLEDGE_DIR.exists():
            return chunks
        for path in KNOWLEDGE_DIR.glob("**/*.txt"):
            text = path.read_text(encoding="utf-8", errors="ignore")
            for i, chunk in enumerate(self._chunk_text(text, 512, 64)):
                chunks.append({"text": chunk, "source": path.name, "chunk_id": i})
        for path in KNOWLEDGE_DIR.glob("**/*.md"):
            text = path.read_text(encoding="utf-8", errors="ignore")
            for i, chunk in enumerate(self._chunk_text(text, 512, 64)):
                chunks.append({"text": chunk, "source": path.name, "chunk_id": i})
        return chunks

    @staticmethod
    def _chunk_text(text: str, size: int, overlap: int) -> list[str]:
        words = text.split()
        chunks = []
        start = 0
        while start < len(words):
            end = min(start + size, len(words))
            chunks.append(" ".join(words[start:end]))
            start += size - overlap
        return chunks


retriever = HybridRetriever()
