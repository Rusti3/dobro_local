const json = (value) => JSON.stringify(value);

function planProjection(row) {
  if (!row) return null;
  const data = row.data || {};
  return {
    ...data,
    id: String(row.id),
    owner: row.owner_id,
    eventId: row.event_id,
    status: row.status,
    when: row.when_at ? new Date(row.when_at).toISOString() : null,
    members: row.members || [],
  };
}

const planSelect = `
  select p.id, p.owner_id, p.event_id, p.status, p.when_at, p.data,
    coalesce(
      jsonb_agg(jsonb_build_object('id', pm.user_id, 'name', pm.display_name) order by pm.joined_at)
        filter (where pm.user_id is not null),
      '[]'::jsonb
    ) as members
  from plans p
  left join plan_members pm on pm.plan_id = p.id
`;

export function createStore(pool) {
  return {
    pool,

    async user(id) {
      const result = await pool.query("select data from app_users where id = $1", [id]);
      return result.rows[0]?.data ?? null;
    },

    async saveUser(user) {
      await pool.query(`
        insert into app_users (id, name, registered, reminders, data, created_at, updated_at)
        values ($1, $2, $3, $4, $5::jsonb, coalesce($6::timestamptz, now()), now())
        on conflict (id) do update set
          name = excluded.name,
          registered = excluded.registered,
          reminders = excluded.reminders,
          data = excluded.data,
          updated_at = now()
      `, [user.id, user.name || "Друг", Boolean(user.registered), Boolean(user.reminders), json(user), user.createdAt || null]);
      return user;
    },

    async users() {
      const result = await pool.query("select data from app_users order by created_at");
      return result.rows.map((row) => row.data);
    },

    async plan(id) {
      const result = await pool.query(`${planSelect} where p.id = $1::uuid group by p.id`, [id]);
      return planProjection(result.rows[0]);
    },

    async savePlan(plan) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const persisted = { ...plan };
        delete persisted.members;
        await client.query(`
          insert into plans (id, owner_id, event_id, status, when_at, data, created_at, updated_at)
          values ($1::uuid, $2, $3, $4, $5::timestamptz, $6::jsonb, coalesce($7::timestamptz, now()), now())
          on conflict (id) do update set
            owner_id = excluded.owner_id,
            event_id = excluded.event_id,
            status = excluded.status,
            when_at = excluded.when_at,
            data = excluded.data,
            updated_at = now()
        `, [plan.id, plan.owner, plan.eventId, plan.status, plan.when || null, json(persisted), plan.createdAt || null]);
        if (plan.members?.length) {
          const values = [];
          const placeholders = plan.members.map((member, index) => {
            const offset = index * 3;
            values.push(plan.id, member.id, member.name || "Друг");
            return `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3})`;
          });
          await client.query(`
            insert into plan_members (plan_id, user_id, display_name) values ${placeholders.join(", ")}
            on conflict (plan_id, user_id) do update set display_name = excluded.display_name
          `, values);
        }
        await client.query("commit");
        return plan;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async joinPlan(planId, user) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from plans where id = $1::uuid for update", [planId]);
        const existing = await client.query("select 1 from plan_members where plan_id = $1::uuid and user_id = $2", [planId, user.id]);
        if (existing.rowCount) {
          await client.query("commit");
          return { joined: false, full: false };
        }
        const count = await client.query("select count(*)::int as count from plan_members where plan_id = $1::uuid", [planId]);
        if (count.rows[0].count >= 3) {
          await client.query("commit");
          return { joined: false, full: true };
        }
        await client.query(`
          insert into plan_members (plan_id, user_id, display_name)
          values ($1::uuid, $2, $3)
          on conflict (plan_id, user_id) do nothing
        `, [planId, user.id, user.name || "Друг"]);
        await client.query("commit");
        return { joined: true, full: false };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async leavePlan(planId, userId) {
      await pool.query("delete from plan_members where plan_id = $1::uuid and user_id = $2", [planId, userId]);
    },

    async plans() {
      const result = await pool.query(`${planSelect} group by p.id order by p.created_at desc`);
      return result.rows.map(planProjection);
    },

    async invite(token) {
      const result = await pool.query("select token, plan_id, expires_at from invites where token = $1", [token]);
      const row = result.rows[0];
      return row ? { token: row.token, plan: String(row.plan_id), expires: new Date(row.expires_at).getTime() } : null;
    },

    async saveInvite(token, planId, expires) {
      await pool.query(`
        insert into invites (token, plan_id, expires_at)
        values ($1, $2::uuid, to_timestamp($3 / 1000.0))
        on conflict (token) do update set plan_id = excluded.plan_id, expires_at = excluded.expires_at
      `, [token, planId, expires]);
    },

    async revoke(planId) {
      await pool.query("delete from invites where plan_id = $1::uuid", [planId]);
    },

    async meta(key) {
      const result = await pool.query("select value from service_meta where key = $1", [key]);
      return result.rows[0]?.value ?? null;
    },

    async setMeta(key, value) {
      await pool.query(`
        insert into service_meta (key, value) values ($1, $2)
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `, [key, String(value)]);
    },

    async deleteUser(id) {
      await pool.query("delete from app_users where id = $1", [id]);
    },

    async close() {
      await pool.end();
    },
  };
}
