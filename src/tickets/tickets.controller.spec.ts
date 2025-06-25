import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Company } from '../../db/models/Company';
import {
  Ticket,
  TicketCategory,
  TicketStatus,
  TicketType,
} from '../../db/models/Ticket';
import { User, UserRole } from '../../db/models/User';
import { DbModule } from '../db.module';
import { TicketsController } from './tickets.controller';
import { Op } from 'sequelize';

describe('TicketsController', () => {
  let controller: TicketsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      imports: [DbModule],
    }).compile();

    controller = module.get<TicketsController>(TicketsController);
  });

  it('should be defined', async () => {
    expect(controller).toBeDefined();

    const res = await controller.findAll();
    console.log(res);
  });

  describe('create', () => {
    describe('managementReport', () => {
      it('creates managementReport ticket', async () => {
        const company = await Company.create({ name: 'test' });
        const user = await User.create({
          name: 'Test User',
          role: UserRole.accountant,
          companyId: company.id,
        });

        const ticket = await controller.create({
          companyId: company.id,
          type: TicketType.managementReport,
        });

        expect(ticket.category).toBe(TicketCategory.accounting);
        expect(ticket.assigneeId).toBe(user.id);
        expect(ticket.status).toBe(TicketStatus.open);
      });

      it('if there are multiple accountants, assign the last one', async () => {
        const company = await Company.create({ name: 'test' });
        await User.create({
          name: 'Test User',
          role: UserRole.accountant,
          companyId: company.id,
        });
        const user2 = await User.create({
          name: 'Test User',
          role: UserRole.accountant,
          companyId: company.id,
        });

        const ticket = await controller.create({
          companyId: company.id,
          type: TicketType.managementReport,
        });

        expect(ticket.category).toBe(TicketCategory.accounting);
        expect(ticket.assigneeId).toBe(user2.id);
        expect(ticket.status).toBe(TicketStatus.open);
      });

      it('if there is no accountant, throw', async () => {
        const company = await Company.create({ name: 'test' });

        await expect(
          controller.create({
            companyId: company.id,
            type: TicketType.managementReport,
          }),
        ).rejects.toEqual(
          new ConflictException(
            `Cannot find user with role accountant to create a ticket`,
          ),
        );
      });
    });

    describe('registrationAddressChange', () => {
      it.each([UserRole.corporateSecretary, UserRole.director])
        ('creates registrationAddressChange ticket (with %s assignee)', async (role) => {
          const company = await Company.create({ name: 'test' });
          const user = await User.create({
            name: 'Test User',
            role,
            companyId: company.id,
          });

          const ticket = await controller.create({
            companyId: company.id,
            type: TicketType.registrationAddressChange,
          });

          expect(ticket.category).toBe(TicketCategory.corporate);
          expect(ticket.assigneeId).toBe(user.id);
          expect(ticket.status).toBe(TicketStatus.open);
        });

      // Skip due to Change Request 1
      it.skip('if there are multiple secretaries, throw', async () => {
        const company = await Company.create({ name: 'test' });
        await User.create({
          name: 'Test User',
          role: UserRole.corporateSecretary,
          companyId: company.id,
        });
        await User.create({
          name: 'Test User',
          role: UserRole.corporateSecretary,
          companyId: company.id,
        });

        await expect(
          controller.create({
            companyId: company.id,
            type: TicketType.registrationAddressChange,
          }),
        ).rejects.toEqual(
          new ConflictException(
            `Multiple users with role corporateSecretary. Cannot create a ticket`,
          ),
        );
      });

      it('if there is both secretary and director, secretary should be assignee', async () => {
        const company = await Company.create({ name: 'test' })

        const secretaryUser = await User.create({
          name: 'Test Secretary',
          role: UserRole.corporateSecretary,
          companyId: company.id,
        });
        await User.create({
          name: 'Test Director',
          role: UserRole.director,
          companyId: company.id,
        });

        const ticket = await controller.create({
          companyId: company.id,
          type: TicketType.registrationAddressChange,
        });

        expect(ticket.assigneeId).toBe(secretaryUser.id)
      })

      it('if there is no secretary nor single director, throw', async () => {
        const company = await Company.create({ name: 'test' });

        await expect(
          controller.create({
            companyId: company.id,
            type: TicketType.registrationAddressChange,
          }),
        ).rejects.toEqual(
          new ConflictException(
            `Cannot find any corporate secretary or single director to create a ticket for registration address change`,
          ),
        );
      });

      it('should throw if there is already an open ticket for registration address change', async () => {
        // Arrange
        const company = await Company.create({ name: 'test' });
        const user = await User.create({
          name: 'Test User',
          role: UserRole.corporateSecretary,
          companyId: company.id,
        });
        await Ticket.create({
          companyId: company.id,
          assigneeId: user.id,
          category: TicketCategory.corporate,
          type: TicketType.registrationAddressChange,
          status: TicketStatus.open,
        });

        // Act & Assert
        await expect(
          controller.create({
            companyId: company.id,
            type: TicketType.registrationAddressChange,
          })).rejects.toEqual(
            new ConflictException(
              `There is already an open ticket for registration address change`,
            ),
          );
      });
    });

    describe('strikeOff', () => {
      it('should create ticket', async () => {
        // Arrange
        const company = await Company.create({ name: 'test' });
        const directorUser = await User.create({
          name: 'Test User',
          role: UserRole.director,
          companyId: company.id,
        });

        // Act
        const ticket = await controller.create({
          companyId: company.id,
          type: TicketType.strikeOff,
        });

        expect(ticket.type).toBe(TicketType.strikeOff);
        expect(ticket.category).toBe(TicketCategory.management);
        expect(ticket.assigneeId).toBe(directorUser.id);
        expect(ticket.status).toBe(TicketStatus.open);
      });

      it('should resolve all active tickets for the company', async () => {
        // Arrange
        const company = await Company.create({ name: 'test' });
        const user = await User.create({
          name: 'Test User',
          role: UserRole.director,
          companyId: company.id,
        });
        await Ticket.create({
          companyId: company.id,
          assigneeId: user.id,
          category: TicketCategory.management,
          type: TicketType.managementReport,
          status: TicketStatus.open,
        });

        // Act
        await controller.create({
          companyId: company.id,
          type: TicketType.strikeOff,
        });

        // Assert
        const allTickets = await Ticket.findAll({
          where: {
            companyId: company.id, type: {
              [Op.not]: TicketType.strikeOff,
            }
          },
        });
        expect(allTickets.some(t => t.status === TicketStatus.open)).toBeFalsy();
      });


      it('should throw if there are multiple directors', async () => {
        const company = await Company.create({ name: 'test' });
        await User.create({
          name: 'Test User 1',
          role: UserRole.director,
          companyId: company.id,
        });
        await User.create({
          name: 'Test User 2',
          role: UserRole.director,
          companyId: company.id,
        });

        await expect(
          controller.create({
            companyId: company.id,
            type: TicketType.strikeOff,
          }),
        ).rejects.toEqual(
          new ConflictException(
            `Cannot create strike off ticket, there should be exactly one director`,
          ),
        );
      });
      it('should throw if there is no directors to be assigned', async () => {
        const company = await Company.create({ name: 'test' });

        await expect(
          controller.create({
            companyId: company.id,
            type: TicketType.strikeOff,
          }),
        ).rejects.toEqual(
          new ConflictException(
            `Cannot create strike off ticket, there should be exactly one director`,
          ),
        );
      });

    })
  });
});
