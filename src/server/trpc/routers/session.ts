import { TRPCError } from '@trpc/server'
import { object, string } from 'zod'
import {
  passwordMismatch,
  sessionNotFound,
  unableToRetrieveSession,
  unknownError,
} from '../messages'
import { sessionProcedure as pSession } from '../middleware/session'
import { zodHandle } from '../shapes'
import { router as _router, publicProcedure } from '../trpc'
import { UserProvider, sessions, users } from '~/server/singleton/service'
import { Constant } from '~/server/common/constants'
import { Logger } from '$base/logger'

const logger = Logger.child({ label: 'session', backend: 'transport', transport: 'trpc' })

export const router = _router({
  login: pSession
    .input(
      object({
        handle: zodHandle,
        md5HashedPassword: string(),
      }),
    )
    .query(async ({ input: { handle, md5HashedPassword }, ctx }) => {
      try {
        const session = await ctx.session.getBinding()
        if (!session) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: unableToRetrieveSession,
          })
        }
        const [ok, user] = await users.testPassword({ handle }, md5HashedPassword)
        if (!ok) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: passwordMismatch,
          })
        }
        const newSessionId = await sessions.update(ctx.session.id, { userId: UserProvider.idToString(user.id) })
        if (newSessionId && newSessionId !== ctx.session.id) {
          setCookie(ctx.h3Event, Constant.SessionLabel, newSessionId, { httpOnly: true })
        }
        return {
          user: mapId(user, UserProvider.idToString),
        }
      }
      catch (err) {
        if (err instanceof TRPCError) {
          throw err
        }

        // unknown error
        logger.error(err)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: unknownError,
        })
      }
    }),
  retrieve: publicProcedure
    .query(async ({ ctx }) => {
      if (!ctx.session.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: sessionNotFound,
        })
      }
      const session = await sessions.get(ctx.session.id)

      if (!session) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: sessionNotFound,
        })
      }
      if (session.userId) {
        try {
          const user = await users.getCompactById({
            id: UserProvider.stringToId(session.userId),
          })
          return {
            user: mapId(user, UserProvider.idToString),
          }
        }
        catch (_) {
          return {
            user: null,
          }
        }
      }
      return {
        user: null,
      }
    }),
  destroy: pSession.mutation(({ ctx }) => {
    deleteCookie(ctx.h3Event, Constant.SessionLabel)
    return sessions.destroy(ctx.session.id)
  }),
})
