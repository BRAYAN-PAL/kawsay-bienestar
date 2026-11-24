-- El hash del secreto se instala en una migración privada, nunca en el repositorio.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS kawsay_private;
REVOKE ALL ON SCHEMA kawsay_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS kawsay_private.documents (
 collection text NOT NULL CHECK (collection IN ('appointments','users','sessions','jobs','audit','settings','incidents','measurements','snapshots','inbox')),
 id text NOT NULL,
 data jsonb NOT NULL,
 PRIMARY KEY(collection,id)
);
ALTER TABLE kawsay_private.documents ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS kawsay_private.control (
 id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0, secret_hash text NOT NULL
);
ALTER TABLE kawsay_private.control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA kawsay_private FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION kawsay_private.protect_audit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
 BEGIN IF OLD.collection='audit' THEN RAISE EXCEPTION 'Historial de solo anexado'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS protect_audit ON kawsay_private.documents;
CREATE TRIGGER protect_audit BEFORE UPDATE OR DELETE ON kawsay_private.documents FOR EACH ROW EXECUTE FUNCTION kawsay_private.protect_audit();
CREATE OR REPLACE FUNCTION public.kawsay_gateway(secret text, expected_revision bigint DEFAULT NULL, operations jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control_row kawsay_private.control%ROWTYPE; op jsonb; payload jsonb;
BEGIN
 SELECT * INTO control_row FROM kawsay_private.control WHERE id=1 FOR UPDATE;
 IF secret IS NULL OR length(secret)<64 OR control_row.secret_hash IS NULL OR pg_catalog.encode(extensions.digest(secret,'sha256'),'hex')<>control_row.secret_hash THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE='42501'; END IF;
 IF operations IS NOT NULL THEN
  IF expected_revision IS DISTINCT FROM control_row.revision THEN RAISE EXCEPTION 'Conflicto de revisión' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(operations)<>'array' OR jsonb_array_length(operations)>20000 THEN RAISE EXCEPTION 'Lote inválido'; END IF;
  FOR op IN SELECT * FROM jsonb_array_elements(operations) LOOP
   IF op->>'action'='put' THEN
    IF op->>'collection'='audit' THEN
     INSERT INTO kawsay_private.documents(collection,id,data) VALUES(op->>'collection',op->>'id',op->'data');
    ELSE
     INSERT INTO kawsay_private.documents(collection,id,data) VALUES(op->>'collection',op->>'id',op->'data') ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data;
    END IF;
   ELSIF op->>'action'='remove' AND op->>'collection'<>'audit' THEN
    DELETE FROM kawsay_private.documents WHERE collection=op->>'collection' AND id=op->>'id';
   ELSE RAISE EXCEPTION 'Operación inválida'; END IF;
  END LOOP;
  UPDATE kawsay_private.control SET revision=revision+1 WHERE id=1 RETURNING * INTO control_row;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('collection',collection,'id',id,'data',data)),'[]'::jsonb) INTO payload FROM kawsay_private.documents;
 RETURN jsonb_build_object('revision',control_row.revision,'documents',payload);
END;
$$;
REVOKE ALL ON FUNCTION public.kawsay_gateway(text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kawsay_gateway(text,bigint,jsonb) TO anon;
