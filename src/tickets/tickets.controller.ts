import { Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import { Company } from '../../db/models/Company';
import {
  Ticket,
  TicketCategory,
  TicketStatus,
  TicketType,
} from '../../db/models/Ticket';
import { User, UserRole } from '../../db/models/User';
import { Op } from 'sequelize';

interface newTicketDto extends Pick<Ticket, 'type' | 'companyId'> { }

interface TicketDto {
  id: number;
  type: TicketType;
  companyId: number;
  assigneeId: number;
  status: TicketStatus;
  category: TicketCategory;
}

const TicketTypeToCategory: Record<TicketType, TicketCategory> = {
  [TicketType.managementReport]: TicketCategory.accounting,
  [TicketType.registrationAddressChange]: TicketCategory.corporate,
  [TicketType.strikeOff]: TicketCategory.management,
}

const TicketTypeToUserRole: Record<TicketType, UserRole> = {
  [TicketType.managementReport]: UserRole.accountant,
  [TicketType.registrationAddressChange]: UserRole.corporateSecretary,
  [TicketType.strikeOff]: UserRole.director,
}

@Controller('api/v1/tickets')
export class TicketsController {
  @Get()
  async findAll() {
    return await Ticket.findAll({ include: [Company, User] });
  }

  @Post()
  async create(@Body() newTicketDto: newTicketDto) {
    const { type, companyId } = newTicketDto;

    const category = TicketTypeToCategory[type];
    if (!category) {
      throw new ConflictException(`Invalid ticket type: ${type}`);
    }
    if (type === TicketType.strikeOff) {

      const directors = await User.findAll({
        where: { companyId, role: UserRole.director },
        limit: 2,
      });

      if (directors.length !== 1) {
        throw new ConflictException(
          `Cannot create strike off ticket, there should be exactly one director`,
        );
      }

      const closeOpenTicketTask = Ticket.update(
        { status: TicketStatus.resolved },
        {
          where: {
            companyId,
            type: {
              [Op.not]: TicketType.strikeOff,
            },
            status: TicketStatus.open,
          },
        },
      );

      const newStrikeOffTicketTask = Ticket.create({
        companyId,
        assigneeId: directors[0].id,
        category: TicketCategory.management,
        type: TicketType.strikeOff,
        status: TicketStatus.open,
      });

      const [_, newStrikeOffTicket] = await Promise.all([closeOpenTicketTask, newStrikeOffTicketTask]);

      const ticketDto: TicketDto = {
        id: newStrikeOffTicket.id,
        type: newStrikeOffTicket.type,
        assigneeId: newStrikeOffTicket.assigneeId,
        status: newStrikeOffTicket.status,
        category: newStrikeOffTicket.category,
        companyId: newStrikeOffTicket.companyId,
      };

      return ticketDto;

    }
    else if (type === TicketType.registrationAddressChange) {
      const existingTicket = await Ticket.findOne({
        where: {
          companyId,
          type: TicketType.registrationAddressChange,
          // TODO: Likely an open ticket should be checked
          status: TicketStatus.open,
        },
      })

      if (existingTicket) {
        throw new ConflictException(
          `There is already an open ticket for registration address change`,
        );
      }

      const userRolesToAssign = [UserRole.director, UserRole.corporateSecretary];
      const companyUsers = await User.findAll({
        where: { companyId, role: userRolesToAssign },
        order: [['createdAt', 'DESC']],
      });

      const corpSecs = companyUsers.filter(
        (user) => user.role === UserRole.corporateSecretary,
      );
      const directors = companyUsers.filter(
        (user) => user.role === UserRole.director,
      );

      if (corpSecs.length === 0 && directors.length !== 1) {
        throw new ConflictException(
          `Cannot find any corporate secretary or single director to create a ticket for registration address change`,
        );
      }

      const assignee = corpSecs[0] ?? directors[0];

      const newChangeAddressTicket = await Ticket.create({
        companyId,
        assigneeId: assignee.id,
        category,
        type,
        status: TicketStatus.open,
      });

      const ticketDto: TicketDto = {
        id: newChangeAddressTicket.id,
        type: newChangeAddressTicket.type,
        assigneeId: newChangeAddressTicket.assigneeId,
        status: newChangeAddressTicket.status,
        category: newChangeAddressTicket.category,
        companyId: newChangeAddressTicket.companyId,
      };

      return ticketDto;

    } else {
      const userRole = TicketTypeToUserRole[type];
      if (!userRole) {
        throw new ConflictException(`Invalid user role for ticket type: ${type}`);
      }

      const assignees = await User.findAll({
        where: { companyId, role: userRole },
        order: [['createdAt', 'DESC']],
      });

      if (!assignees.length)
        throw new ConflictException(
          `Cannot find user with role ${userRole} to create a ticket`,
        );

      const assignee = assignees[0];

      const ticket = await Ticket.create({
        companyId,
        assigneeId: assignee.id,
        category,
        type,
        status: TicketStatus.open,
      });

      const ticketDto: TicketDto = {
        id: ticket.id,
        type: ticket.type,
        assigneeId: ticket.assigneeId,
        status: ticket.status,
        category: ticket.category,
        companyId: ticket.companyId,
      };

      return ticketDto;
    }
  }
}
