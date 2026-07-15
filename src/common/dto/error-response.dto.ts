import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'Single string for most errors; array of per-field strings for ValidationPipe (400) failures.',
    example: 'Invalid credentials',
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;
}
