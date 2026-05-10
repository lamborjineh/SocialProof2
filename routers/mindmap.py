"""
SocialProof — Router: Dynamic Mindmap API  (v2)

Public endpoints (no auth required):
  GET  /api/mindmap/graph?map=main          — full graph (nodes + edges + interactions)
  POST /api/mindmap/progress                — batch-save discovered node_ids (auth required)
  GET  /api/mindmap/progress?map=main       — list discovered nodes for current user
  POST /api/mindmap/suggestions             — submit a node suggestion (auth optional)

Admin endpoints (admin role required):
  GET    /api/admin/mindmap/nodes           — list all nodes
  POST   /api/admin/mindmap/nodes           — create a node
  PUT    /api/admin/mindmap/nodes/{node_id} — update a node
  DELETE /api/admin/mindmap/nodes/{node_id} — delete a node (+ edges/interactions)
  POST   /api/admin/mindmap/edges           — create an edge
  DELETE /api/admin/mindmap/edges/{edge_id} — delete an edge
  GET    /api/admin/mindmap/suggestions     — list pending suggestions
  PUT    /api/admin/mindmap/suggestions/{id} — approve / reject a suggestion

Legacy endpoints kept for backwards compatibility:
  GET  /mindmap/progress           — old lens-based progress (still works)
  POST /mindmap/progress/{lens_id} — old lens mark (still works)
"""

import re
import uuid
from datetime import datetime
from typing import List, Optional

import sqlalchemy as sa
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import logger
from database.models import (
    MindmapEdgeORM,
    MindmapInteractionORM,
    MindmapLensProgressORM,
    MindmapNodeORM,
    MindmapProgressORM,
    MindmapSuggestionORM,
    engine,
)
from routers.auth import get_current_user

router = APIRouter()

# ── Fallback edge seed (from_id, to_id) ─────────────────────────────────────
# These mirror the hardcoded FALLBACK_NODES revealedBy in mindmap.js.
# Auto-seeded into the DB on first graph request so the map works out of the box.
_FALLBACK_EDGES = [
    ("root",                  "angry_spreads"),
    ("root",                  "who_shared"),
    ("root",                  "why_trust"),
    ("root",                  "why_spread"),
    ("angry_spreads",         "ragebait"),
    ("angry_spreads",         "emotional_language"),
    ("angry_spreads",         "rec_algo"),
    ("angry_spreads",         "firehose"),
    ("who_shared",            "influencer_psych"),
    ("who_shared",            "bot_networks"),
    ("who_shared",            "echo_chambers"),
    ("who_shared",            "bandwagon"),
    ("why_trust",             "fake_image"),
    ("why_trust",             "outrage_content"),
    ("why_trust",             "illusory_truth"),
    ("why_spread",            "rec_algo"),
    ("why_spread",            "firehose"),
    ("rec_algo",              "filter_bubbles"),
    ("rec_algo",              "addictive_feeds"),
    ("rec_algo",              "conspiracy_loops"),
    ("rec_algo",              "illusory_truth"),
    ("fake_image",            "humans_trust_faces"),
    ("fake_image",            "deepfakes"),
    ("fake_image",            "political_manipulation"),
    ("fake_image",            "source_laundering"),
    ("political_manipulation","source_laundering"),
    ("emotional_language",    "screenshot_proof"),
    ("ragebait",              "screenshot_proof"),
    ("bot_networks",          "mob_mentality"),
    ("bot_networks",          "astroturfing"),
    ("bot_networks",          "manufactured_consensus"),
    ("bot_networks",          "sealioning"),
    ("comment_war",           "mob_mentality"),
    ("comment_war",           "polarization"),
    ("comment_war",           "sealioning"),
    ("bot_networks",          "comment_war"),
    ("echo_chambers",         "manufactured_consensus"),
    ("influencer_psych",      "bandwagon"),
    ("manufactured_consensus","astroturfing"),
]

def _seed_edges_if_empty(db, map_id: str = "main"):
    """Insert fallback edges if the DB has none for this map yet."""
    count = db.execute(
        sa.text("SELECT COUNT(*) FROM mindmap_edges WHERE map_id = :mid"),
        {"mid": map_id},
    ).scalar()
    if count == 0:
        for from_id, to_id in _FALLBACK_EDGES:
            db.execute(
                sa.text(
                    "INSERT IGNORE INTO mindmap_edges (map_id, from_id, to_id) "
                    "VALUES (:mid, :fid, :tid)"
                ),
                {"mid": map_id, "fid": from_id, "tid": to_id},
            )
        db.commit()


def _ensure_root_start_visible(db, map_id: str = "main"):
    """Make sure the root node always has start_visible=1.
    The admin editor defaults new nodes to start_visible=0, which would
    make the root invisible on load. This corrects it automatically."""
    db.execute(
        sa.text(
            "UPDATE mindmap_nodes SET start_visible = 1 "
            "WHERE id = 'root' AND map_id = :mid AND start_visible = 0"
        ),
        {"mid": map_id},
    )
    db.commit()


# ── helpers ───────────────────────────────────────────────────────────────────

def _require_admin(request: Request, authorization: str = None):
    payload = get_current_user(request, authorization)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload


def _node_to_dict(n) -> dict:
    return {
        "id":           n.id,
        "map_id":       n.map_id,
        "type":         n.type,
        "icon":         n.icon,
        "label":        n.label,
        "sub":          n.sub,
        "color":        n.color,
        "x":            n.x,
        "y":            n.y,
        "startVisible": bool(n.start_visible),
        "sort_order":   n.sort_order,
        "active":       bool(n.active),
    }


def _interaction_to_dict(i) -> dict:
    d = {
        "icon":      i.icon,
        "title":     i.title,
        "context":   i.context,
        "widget":    i.widget_json,
        "aftermath": i.aftermath,
    }
    if i.media_type and i.media_url:
        d["media"] = {"type": i.media_type, "url": i.media_url, "thumb": i.media_thumb}
    return d


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class ProgressBatchBody(BaseModel):
    node_ids: List[str]
    map_id:   str = "main"


class SuggestionBody(BaseModel):
    label:           str
    reason:          Optional[str] = None
    connect_from_id: Optional[str] = None
    map_id:          str = "main"


class NodeCreateBody(BaseModel):
    id:            Optional[str] = None   # auto-generated from label if omitted
    map_id:        str = "main"
    type:          str = "leaf"
    icon:          str = "📌"
    label:         str
    sub:           Optional[str] = None
    color:         str = "#4488ff"
    x:             int = 1800
    y:             int = 1500
    start_visible: bool = False
    sort_order:    int = 0
    active:        bool = True
    media_type:    Optional[str] = None
    media_url:     Optional[str] = None
    media_thumb:   Optional[str] = None


class NodeUpdateBody(BaseModel):
    icon:          Optional[str]  = None
    label:         Optional[str]  = None
    sub:           Optional[str]  = None
    color:         Optional[str]  = None
    x:             Optional[int]  = None
    y:             Optional[int]  = None
    start_visible: Optional[bool] = None
    sort_order:    Optional[int]  = None   # 0 = auto-size, >0 = explicit px
    active:        Optional[bool] = None
    media_type:    Optional[str]  = None
    media_url:     Optional[str]  = None
    media_thumb:   Optional[str]  = None


class EdgeCreateBody(BaseModel):
    from_id: str
    to_id:   str
    map_id:  str = "main"


class SuggestionReviewBody(BaseModel):
    status:     str
    admin_note: Optional[str] = None


# ══════════════════════════════════════════════════════════════════════════════
#  PUBLIC — GRAPH
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/mindmap/graph")
async def get_mindmap_graph(map: str = Query("main")):
    db = Session(engine)
    try:
        _seed_edges_if_empty(db, map)
        _ensure_root_start_visible(db, map)
        nodes = db.query(MindmapNodeORM).filter_by(map_id=map, active=True).order_by(
            MindmapNodeORM.sort_order, MindmapNodeORM.id
        ).all()

        edges = db.execute(
            sa.text("SELECT id, from_id, to_id FROM mindmap_edges WHERE map_id = :mid"),
            {"mid": map},
        ).fetchall()

        interactions = db.query(MindmapInteractionORM).filter_by(map_id=map).all()

        revealed_by: dict = {}
        for e in edges:
            revealed_by.setdefault(e.to_id, []).append(e.from_id)

        node_dicts = []
        for n in nodes:
            d = _node_to_dict(n)
            d["revealedBy"] = revealed_by.get(n.id, [])
            node_dicts.append(d)

        interaction_map = {i.node_id: _interaction_to_dict(i) for i in interactions}

        return {
            "map_id":       map,
            "nodes":        node_dicts,
            "edges":        [{"id": e.id, "from": e.from_id, "to": e.to_id} for e in edges],
            "interactions": interaction_map,
        }
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
#  PUBLIC — PROGRESS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/mindmap/progress")
async def get_mindmap_progress_v2(
    request: Request,
    map: str = Query("main"),
    authorization: str = Header(None),
):
    payload = get_current_user(request, authorization)
    user_id = int(payload["sub"])

    db = Session(engine)
    try:
        rows = db.query(MindmapProgressORM).filter_by(
            user_id=user_id, map_id=map
        ).order_by(MindmapProgressORM.viewed_at.desc()).all()

        total = db.query(MindmapNodeORM).filter_by(map_id=map, active=True).count()

        last_node_label = None
        if rows:
            node = db.query(MindmapNodeORM).filter_by(id=rows[0].node_id, map_id=map).first()
            if node:
                last_node_label = node.label

        return {
            "discovered":      [r.node_id for r in rows],
            "total":           total,
            "last_node_label": last_node_label,
        }
    finally:
        db.close()


@router.post("/api/mindmap/progress", status_code=200)
async def save_mindmap_progress(
    body: ProgressBatchBody,
    request: Request,
    authorization: str = Header(None),
):
    payload = get_current_user(request, authorization)
    user_id = int(payload["sub"])

    db = Session(engine)
    try:
        for node_id in body.node_ids:
            exists = db.query(MindmapProgressORM).filter_by(
                user_id=user_id, map_id=body.map_id, node_id=node_id
            ).first()
            if not exists:
                db.add(MindmapProgressORM(user_id=user_id, map_id=body.map_id, node_id=node_id))
        db.commit()
        return {"ok": True, "saved": len(body.node_ids)}
    except Exception as e:
        db.rollback()
        logger.error(f"[Mindmap] progress save error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save progress.")
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
#  PUBLIC — SUGGESTIONS
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/api/mindmap/suggestions", status_code=201)
async def submit_suggestion(
    body: SuggestionBody,
    request: Request,
    authorization: str = Header(None),
):
    user_id = None
    try:
        payload = get_current_user(request, authorization)
        user_id = int(payload["sub"])
    except Exception:
        pass  # guests can suggest without auth

    db = Session(engine)
    try:
        row = MindmapSuggestionORM(
            user_id=user_id,
            map_id=body.map_id,
            label=body.label,
            reason=body.reason,
            connect_from_id=body.connect_from_id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, "id": row.id}
    except Exception as e:
        db.rollback()
        logger.error(f"[Mindmap] suggestion save error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save suggestion.")
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
#  ADMIN — NODES
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/admin/mindmap/nodes")
async def admin_list_nodes(
    request: Request,
    map: str = Query("main"),
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        nodes = db.query(MindmapNodeORM).filter_by(map_id=map).order_by(
            MindmapNodeORM.sort_order, MindmapNodeORM.id
        ).all()
        edges = db.execute(
            sa.text("SELECT id, from_id, to_id FROM mindmap_edges WHERE map_id = :mid"),
            {"mid": map},
        ).fetchall()
        return {
            "nodes": [_node_to_dict(n) for n in nodes],
            "edges": [{"id": e.id, "from_id": e.from_id, "to_id": e.to_id} for e in edges],
        }
    finally:
        db.close()


@router.post("/api/admin/mindmap/nodes", status_code=201)
async def admin_create_node(
    body: NodeCreateBody,
    request: Request,
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        # Auto-generate id from label if not supplied
        node_id = body.id
        if not node_id:
            slug = re.sub(r'[^a-z0-9]+', '_', body.label.lower()).strip('_')[:40]
            node_id = f"{slug}_{uuid.uuid4().hex[:6]}"

        if db.query(MindmapNodeORM).filter_by(id=node_id, map_id=body.map_id).first():
            node_id = f"{node_id}_{uuid.uuid4().hex[:4]}"  # collision fallback

        data = body.model_dump()
        data['id'] = node_id
        # Media lives in mindmap_interactions, not mindmap_nodes — pull it out
        media_type  = data.pop('media_type', None)
        media_url   = data.pop('media_url', None)
        media_thumb = data.pop('media_thumb', None)
        node = MindmapNodeORM(**data)
        db.add(node)
        db.flush()
        # If media provided, upsert into interactions
        if media_type and media_url:
            existing_i = db.query(MindmapInteractionORM).filter_by(node_id=node_id, map_id=data['map_id']).first()
            if existing_i:
                existing_i.media_type  = media_type
                existing_i.media_url   = media_url
                existing_i.media_thumb = media_thumb
            else:
                db.add(MindmapInteractionORM(
                    node_id=node_id, map_id=data['map_id'],
                    icon=data.get('icon', '📌'), title=data.get('label', ''),
                    widget_type='none',
                    media_type=media_type, media_url=media_url, media_thumb=media_thumb,
                ))
        db.commit()
        db.refresh(node)
        return _node_to_dict(node)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


class PositionUpdate(BaseModel):
    id: str
    x: int
    y: int

class PositionsBatchBody(BaseModel):
    map_id: str = "main"
    updates: List[PositionUpdate]


@router.put("/api/admin/mindmap/nodes/positions")
async def admin_batch_update_positions(
    body: PositionsBatchBody,
    request: Request,
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        for upd in body.updates:
            node = db.query(MindmapNodeORM).filter_by(id=upd.id, map_id=body.map_id).first()
            if node:
                node.x = upd.x
                node.y = upd.y
        db.commit()
        return {"ok": True, "updated": len(body.updates)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.put("/api/admin/mindmap/nodes/{node_id}")
async def admin_update_node(
    node_id: str,
    body: NodeUpdateBody,
    request: Request,
    map: str = Query("main"),
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        node = db.query(MindmapNodeORM).filter_by(id=node_id, map_id=map).first()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found.")
        updates = body.model_dump(exclude_none=True)
        # Media fields go to interactions, not nodes
        media_type  = updates.pop('media_type', None)
        media_url   = updates.pop('media_url',  None)
        media_thumb = updates.pop('media_thumb', None)
        for field, value in updates.items():
            if hasattr(node, field):
                setattr(node, field, value)
        # Upsert interaction media
        if media_type is not None:
            interaction = db.query(MindmapInteractionORM).filter_by(node_id=node_id, map_id=map).first()
            if interaction:
                interaction.media_type  = media_type or None
                interaction.media_url   = media_url  or None
                interaction.media_thumb = media_thumb or None
            elif media_type and media_url:
                db.add(MindmapInteractionORM(
                    node_id=node_id, map_id=map,
                    icon=node.icon, title=node.label,
                    widget_type='none',
                    media_type=media_type, media_url=media_url, media_thumb=media_thumb,
                ))
        db.commit()
        db.refresh(node)
        return _node_to_dict(node)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.delete("/api/admin/mindmap/nodes/{node_id}", status_code=200)
async def admin_delete_node(
    node_id: str,
    request: Request,
    map: str = Query("main"),
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        node = db.query(MindmapNodeORM).filter_by(id=node_id, map_id=map).first()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found.")
        db.execute(
            sa.text("DELETE FROM mindmap_edges WHERE map_id=:mid AND (from_id=:nid OR to_id=:nid)"),
            {"mid": map, "nid": node_id},
        )
        db.execute(
            sa.text("DELETE FROM mindmap_interactions WHERE map_id=:mid AND node_id=:nid"),
            {"mid": map, "nid": node_id},
        )
        db.delete(node)
        db.commit()
        return {"ok": True, "deleted": node_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
#  ADMIN — EDGES
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/api/admin/mindmap/edges", status_code=201)
async def admin_create_edge(
    body: EdgeCreateBody,
    request: Request,
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        edge = MindmapEdgeORM(map_id=body.map_id, from_id=body.from_id, to_id=body.to_id)
        db.add(edge)
        db.commit()
        db.refresh(edge)
        return {"id": edge.id, "from": edge.from_id, "to": edge.to_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Edge exists or DB error: {e}")
    finally:
        db.close()


@router.delete("/api/admin/mindmap/edges/{edge_id}", status_code=200)
async def admin_delete_edge(
    edge_id: int,
    request: Request,
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        db.execute(sa.text("DELETE FROM mindmap_edges WHERE id = :eid"), {"eid": edge_id})
        db.commit()
        return {"ok": True, "deleted": edge_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
#  ADMIN — SUGGESTIONS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/admin/mindmap/suggestions")
async def admin_list_suggestions(
    request: Request,
    status: Optional[str] = Query(None),
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    db = Session(engine)
    try:
        q = db.query(MindmapSuggestionORM)
        if status:
            q = q.filter_by(status=status)
        rows = q.order_by(MindmapSuggestionORM.submitted_at.desc()).all()
        return {"suggestions": [
            {
                "id": r.id, "user_id": r.user_id, "map_id": r.map_id,
                "label": r.label, "reason": r.reason,
                "connect_from_id": r.connect_from_id,
                "status": r.status, "admin_note": r.admin_note,
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
                "reviewed_at":  r.reviewed_at.isoformat()  if r.reviewed_at  else None,
            }
            for r in rows
        ]}
    finally:
        db.close()


@router.put("/api/admin/mindmap/suggestions/{suggestion_id}")
async def admin_review_suggestion(
    suggestion_id: int,
    body: SuggestionReviewBody,
    request: Request,
    authorization: str = Header(None),
):
    _require_admin(request, authorization)
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=422, detail="status must be 'approved' or 'rejected'.")
    db = Session(engine)
    try:
        row = db.query(MindmapSuggestionORM).filter_by(id=suggestion_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Suggestion not found.")
        row.status      = body.status
        row.admin_note  = body.admin_note
        row.reviewed_at = datetime.utcnow()
        db.commit()
        return {"ok": True, "id": suggestion_id, "status": body.status}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
#  LEGACY — lens-based progress (kept for backwards compatibility)
# ══════════════════════════════════════════════════════════════════════════════

_VALID_LENSES = {
    "claim_detection_beginner", "claim_detection_intermediate", "claim_detection_advanced",
    "source_verification_beginner", "source_verification_intermediate", "source_verification_advanced",
    "bias_detection_beginner", "bias_detection_intermediate", "bias_detection_advanced",
    "evidence_evaluation_beginner", "evidence_evaluation_intermediate", "evidence_evaluation_advanced",
    "general_mil_beginner", "general_mil_intermediate", "general_mil_advanced",
}


@router.get("/mindmap/progress")
async def get_mindmap_progress_legacy(
    request: Request,
    authorization: str = Header(None),
):
    payload = get_current_user(request, authorization)
    user_id = payload["sub"]
    db = Session(engine)
    try:
        rows = db.execute(
            sa.text("SELECT lens_id, explored_at FROM mindmap_lens_progress WHERE user_id = :uid ORDER BY explored_at ASC"),
            {"uid": user_id},
        ).fetchall()
        return {
            "user_id":  user_id,
            "explored": [{"lens_id": r.lens_id, "explored_at": r.explored_at.isoformat()} for r in rows],
            "count":    len(rows),
            "total":    len(_VALID_LENSES),
        }
    finally:
        db.close()


@router.post("/mindmap/progress/{lens_id}", status_code=201)
async def mark_lens_explored_legacy(
    lens_id: str,
    request: Request,
    authorization: str = Header(None),
):
    if lens_id not in _VALID_LENSES:
        raise HTTPException(status_code=422, detail=f"Unknown lens_id: {lens_id!r}")
    payload = get_current_user(request, authorization)
    user_id = payload["sub"]
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT id FROM mindmap_lens_progress WHERE user_id = :uid AND lens_id = :lid"),
            {"uid": user_id, "lid": lens_id},
        ).fetchone()
        if not existing:
            db.add(MindmapLensProgressORM(user_id=user_id, lens_id=lens_id))
            db.commit()
        return {"ok": True, "lens_id": lens_id, "user_id": user_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save lens progress.")
    finally:
        db.close()
